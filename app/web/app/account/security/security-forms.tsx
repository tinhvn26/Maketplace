"use client";

import { useActionState, useRef } from "react";
import { FormMessage, SubmitButton } from "@/components/form";
import { Button, Field, Input } from "@/components/ui";
import { changeEmail, changePassword, deleteAccount } from "@/lib/actions/account";

export function ChangePasswordForm() {
  const [state, action] = useActionState(changePassword, {});
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <Field label="Mật khẩu hiện tại" htmlFor="currentPassword">
        <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} />
      </Field>
      <Field label="Mật khẩu mới" htmlFor="newPassword" hint="Từ 8 đến 128 ký tự.">
        <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={128} />
      </Field>
      <SubmitButton className="w-full sm:w-auto">Đổi mật khẩu</SubmitButton>
    </form>
  );
}

export function ChangeEmailForm() {
  const [state, action] = useActionState(changeEmail, {});
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <Field label="Email mới" htmlFor="newEmail">
        <Input id="newEmail" name="newEmail" type="email" autoComplete="email" required maxLength={254} defaultValue={state.values?.newEmail} />
      </Field>
      <Field label="Mật khẩu hiện tại" htmlFor="emailPassword">
        <Input id="emailPassword" name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} />
      </Field>
      <SubmitButton className="w-full sm:w-auto">Đổi email</SubmitButton>
    </form>
  );
}

export function DeleteAccount() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action] = useActionState(deleteAccount, {});
  return (
    <>
      <Button type="button" tone="danger" onClick={() => dialog.current?.showModal()} className="w-full sm:w-auto">
        Xoá tài khoản
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby="delete-title"
        className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-lg p-0 shadow-xl backdrop:bg-black/50"
      >
        <form action={action} className="space-y-4 p-5">
          <h3 id="delete-title" className="text-lg font-semibold">
            Xoá tài khoản vĩnh viễn?
          </h3>
          <p className="text-sm text-zinc-600">Bạn sẽ bị đăng xuất khỏi mọi thiết bị. Thao tác này không thể hoàn tác.</p>
          <FormMessage state={state} />
          <Field label="Nhập mật khẩu để xác nhận" htmlFor="deletePassword">
            <Input id="deletePassword" name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} />
          </Field>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" tone="outline" onClick={() => dialog.current?.close()}>
              Huỷ
            </Button>
            <SubmitButton tone="danger" className="">
              Xoá tài khoản
            </SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
