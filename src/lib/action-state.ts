/** Estado común de las Server Actions con formularios (useActionState). */
export interface ActionState {
  error: string | null;
  ok?: boolean;
}

/** Estado de las acciones de recuperación de contraseña. */
export interface RecuperarState {
  error: string | null;
  ok?: string | null;
  link?: string | null;
}
