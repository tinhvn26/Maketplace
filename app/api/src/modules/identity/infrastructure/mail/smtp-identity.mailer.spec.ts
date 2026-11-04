import 'reflect-metadata';
import type { ConfigType } from '@nestjs/config';
import { createServer, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import identityMailConfig from '../../../../config/identity-mail.config.js';
import { SmtpIdentityMailer } from './smtp-identity.mailer.js';

async function startSmtpStub(rejectRecipient = false) {
  const sockets = new Set<Socket>();
  const commands: string[] = [];
  const messages: string[] = [];
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    socket.setEncoding('utf8');
    let buffer = '';
    let receivingData = false;
    let body: string[] = [];
    socket.write('220 localhost test SMTP\r\n');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (receivingData) {
          if (line === '.') {
            messages.push(body.join('\r\n'));
            body = [];
            receivingData = false;
            socket.write('250 2.0.0 Queued\r\n');
          } else {
            body.push(line.startsWith('..') ? line.slice(1) : line);
          }
          continue;
        }

        commands.push(line);
        const command = line.split(' ', 1)[0].toUpperCase();
        switch (command) {
          case 'EHLO':
          case 'HELO':
            socket.write('250 localhost\r\n');
            break;
          case 'MAIL':
          case 'RSET':
            socket.write('250 2.0.0 OK\r\n');
            break;
          case 'RCPT':
            socket.write(
              rejectRecipient
                ? '550 5.1.1 Recipient rejected\r\n'
                : '250 2.1.5 OK\r\n',
            );
            break;
          case 'DATA':
            receivingData = true;
            socket.write('354 End with a dot\r\n');
            break;
          case 'QUIT':
            socket.end('221 2.0.0 Bye\r\n');
            break;
          default:
            socket.write('502 5.5.1 Command not implemented\r\n');
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected an ephemeral TCP address');
  return {
    port: address.port,
    commands,
    messages,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

function configuration(port: number): ConfigType<typeof identityMailConfig> {
  return {
    mode: 'smtp',
    host: '127.0.0.1',
    port,
    from: 'Identity <sender@example.invalid>',
    secure: false,
    requireTLS: false,
    user: undefined,
    password: undefined,
    publicAppUrl: undefined,
  };
}

describe('SmtpIdentityMailer with a local SMTP endpoint', () => {
  let smtp: Awaited<ReturnType<typeof startSmtpStub>> | undefined;
  afterEach(async () => {
    await smtp?.close();
    smtp = undefined;
  });

  it('completes the real Nodemailer SMTP exchange and sends the requested envelope and body', async () => {
    smtp = await startSmtpStub();
    const mailer = new SmtpIdentityMailer(configuration(smtp.port));
    await mailer.send({
      to: 'recipient@example.invalid',
      subject: 'Identity verification',
      text: 'Your single-use code is test-token.',
    });
    expect(smtp.commands.some((line) => line.startsWith('EHLO '))).toBe(true);
    expect(smtp.commands).toContain('MAIL FROM:<sender@example.invalid>');
    expect(smtp.commands).toContain('RCPT TO:<recipient@example.invalid>');
    expect(smtp.messages).toHaveLength(1);
    expect(smtp.messages[0]).toContain('Subject: Identity verification');
    expect(smtp.messages[0]).toContain('To: recipient@example.invalid');
    expect(smtp.messages[0]).toContain('Your single-use code is test-token.');
  });

  it('surfaces recipient rejection so the persisted worker can retry', async () => {
    smtp = await startSmtpStub(true);
    const mailer = new SmtpIdentityMailer(configuration(smtp.port));
    await expect(
      mailer.send({
        to: 'recipient@example.invalid',
        subject: 'Verification',
        text: 'Test token',
      }),
    ).rejects.toThrow();
    expect(smtp.messages).toHaveLength(0);
  });

  it('refuses plaintext delivery when TLS is required but unavailable', async () => {
    smtp = await startSmtpStub();
    const mailer = new SmtpIdentityMailer({
      ...configuration(smtp.port),
      requireTLS: true,
    });
    await expect(
      mailer.send({
        to: 'recipient@example.invalid',
        subject: 'Verification',
        text: 'Test token',
      }),
    ).rejects.toThrow();
    expect(smtp.commands).toContain('STARTTLS');
    expect(smtp.commands.some((line) => line.startsWith('MAIL FROM:'))).toBe(
      false,
    );
    expect(smtp.messages).toHaveLength(0);
  });

  it('refuses to deliver when configured in local outbox mode', async () => {
    const mailer = new SmtpIdentityMailer({
      ...configuration(1),
      mode: 'outbox',
    });
    await expect(
      mailer.send({
        to: 'recipient@example.invalid',
        subject: 'Verification',
        text: 'Test token',
      }),
    ).rejects.toThrow('SMTP delivery is not configured');
  });
});
