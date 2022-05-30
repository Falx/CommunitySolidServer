/**
 * Allows for initializing state or executing logic when the application is started.
 */
export interface Initializable {
  initialize: () => Promise<void>;
}
