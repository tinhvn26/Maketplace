// For other modules' persistence adapters that record which assets a resource
// uses inside their own write transaction. Never import this from domain/application.
export {
  bindMediaUsages,
  releaseMediaUsages,
} from '../infrastructure/persistence/media-usage.persistence.js';
