type ErrorModalPayload = {
  title: string;
  message: string;
};

type ErrorModalListener = (payload: ErrorModalPayload) => void;

const listeners = new Set<ErrorModalListener>();

let lastShownKey = "";
let lastShownAt = 0;

const ERROR_MESSAGES_ES: Record<string, string> = {
  REQUEST_FAILED: "No se pudo completar la solicitud.",
  NETWORK_ERROR: "No hay conexion con el servidor. Intentalo de nuevo.",
  UNAUTHORIZED: "Tu sesion no es valida. Vuelve a entrar.",
  RATE_LIMITED: "Se alcanzo el limite de solicitudes. Espera un momento e intentalo de nuevo.",
  NICKNAME_TAKEN: "Ese nickname ya esta en uso en la partida. Prueba otro.",
  INVALID_NICKNAME: "El nickname no es valido. Usa entre 4 y 12 caracteres.",
  MISSING_DEVICE_ID: "No se pudo identificar este dispositivo. Reinicia la app e intentalo de nuevo.",
  ROOM_CREATE_FAILED: "No se pudo crear la sala. Intentalo otra vez.",
  CREATE_ROOM_FAILED: "No se pudo crear la sala. Intentalo otra vez.",
  ALREADY_IN_ROOM: "Ya estas dentro de una sala.",
  ROOM_NOT_FOUND: "La sala ya no existe.",
  OWNER_NOT_FOUND: "No se encontro al administrador de la sala.",
  ROOM_CLOSED: "La sala esta cerrada.",
  ROOM_ALREADY_STARTED: "La partida ya ha comenzado.",
  ROOM_ALREADY_ENDED: "La partida ya ha finalizado.",
  ALREADY_STARTED: "La partida ya ha comenzado.",
  GAME_NOT_STARTED: "La partida aun no ha comenzado.",
  GAME_NOT_ENDED: "La partida aun no ha finalizado.",
  PLAYER_NOT_FOUND: "No se encontro el jugador.",
  INVALID_PLAYER_ID: "El jugador indicado no es valido.",
  NOT_ALLOWED: "No tienes permiso para realizar esta accion.",
  FORBIDDEN: "No tienes permiso para realizar esta accion.",
  ROOM_MISMATCH: "Esa accion no corresponde a esta sala.",
  NO_MEDIA: "No hay contenido multimedia disponible.",
  NO_IMAGES: "No hay imagenes para descargar.",
  NO_PLAYERS: "No hay jugadores disponibles.",
  NO_DOWNLOADABLE_IMAGES: "No hay imagenes descargables disponibles.",
  TOO_MANY_ATTEMPTS: "Has hecho demasiados intentos. Espera un momento.",
  NO_ROOM: "No estas dentro de ninguna sala.",
  INVALID_FORM: "El formulario enviado no es valido.",
  INVALID_BODY: "Los datos enviados no son validos.",
  INVALID_JSON: "El formato de la solicitud no es valido.",
  INVALID_ROOM_CODE: "El código de sala no es valido.",
  INVALID_ROOM_NAME: "El nombre de sala no es valido.",
  INVALID_ROUNDS: "El número de rondas no es valido.",
  INVALID_FILE_TYPE: "El tipo de archivo no es valido.",
  INVALID_MIME: "El tipo de archivo no es valido.",
  INVALID_PATH: "La ruta del archivo no es valida.",
  FILE_TOO_LARGE: "El archivo es demasiado grande.",
  MISSING_FILE: "Falta el archivo para completar la accion.",
  INVALID_PLAYER_CHALLENGE_ID: "El reto ya no es valido.",
  INVALID_CHALLENGE_ID: "El reto indicado no es valido.",
  CHALLENGE_NOT_FOUND: "No se encontro el reto.",
  NOT_FOUND: "No se encontro el recurso solicitado.",
  UPLOAD_FAILED: "No se pudo subir el archivo.",
  COMPLETE_FAILED: "No se pudo completar el reto.",
  DELETE_FAILED: "No se pudo eliminar el archivo.",
  SAVE_FAILED: "No se pudo guardar el archivo.",
  EMAIL_NOT_CONFIGURED: "El envio por correo no esta configurado.",
  EMAIL_SEND_FAILED: "No se pudo enviar el correo.",
  INVALID_EMAIL: "El correo electronico no es valido.",
  INVALID_PASSWORD: "La contrasena no es valida.",
  MISSING_PASSWORD: "Falta la contrasena.",
  ADMIN_NOT_CONFIGURED: "La administracion no esta configurada.",
  DEVICE_NOT_REGISTERED: "Este dispositivo no esta registrado en la partida.",
  SESSION_NOT_FOUND: "No se encontro la sesion. Vuelve a entrar.",
  INVALID_SESSION: "Tu sesion no es valida. Vuelve a entrar.",
  MISSING_DB_MIGRATION_ROOM_NAME: "Falta una actualizacion del servidor. Contacta con soporte.",
  MISSING_DB_MIGRATION_ROUNDS: "Falta una actualizacion del servidor. Contacta con soporte.",
  MISSING_RPC_ASSIGN_CHALLENGES: "Falta una actualizacion del servidor. Contacta con soporte.",
  MISSING_RPC_REJECT: "Falta una actualizacion del servidor. Contacta con soporte.",
  REJECT_FAILED: "No se pudo completar la accion solicitada.",
  PAUSE_DISABLED: "Esta accion no esta habilitada en el servidor.",
  SQL: "Ha ocurrido un error interno. Intentalo de nuevo.",
  DB: "Ha ocurrido un error interno. Intentalo de nuevo.",
  RPC_FAILED: "Ha ocurrido un error interno. Intentalo de nuevo.",
  INTERNAL_ERROR: "Ha ocurrido un error interno. Intentalo de nuevo."
};

function toSpanishFallback(raw: string): string {
  const compact = raw.trim();
  if (!compact) return ERROR_MESSAGES_ES.REQUEST_FAILED;
  if (compact.toUpperCase().startsWith("HTTP_")) {
    return "El servidor devolvio un error. Intentalo de nuevo.";
  }
  if (compact.toUpperCase().startsWith("REQUEST_TIMEOUT")) {
    return "La solicitud tardo demasiado. Revisa tu conexión e intentalo de nuevo.";
  }
  if (/^[A-Z0-9_]+$/.test(compact)) {
    return compact
      .toLowerCase()
      .split("_")
      .join(" ")
      .replace(/^./, (c) => c.toUpperCase());
  }
  return compact;
}

export function normalizeErrorMessage(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return ERROR_MESSAGES_ES.REQUEST_FAILED;
  const code = raw.toUpperCase();

  // Fuzzy matches for backend variants and plain-text errors.
  if (code.includes("NICKNAME") && code.includes("TAKEN")) return ERROR_MESSAGES_ES.NICKNAME_TAKEN;
  if (code.includes("USERNAME") && code.includes("TAKEN")) return ERROR_MESSAGES_ES.NICKNAME_TAKEN;
  if (code.includes("ROOM") && code.includes("NOT") && code.includes("FOUND")) return ERROR_MESSAGES_ES.ROOM_NOT_FOUND;
  if (code.includes("ROOM") && code.includes("CLOSED")) return ERROR_MESSAGES_ES.ROOM_CLOSED;
  if (code.includes("ALREADY") && code.includes("START")) return ERROR_MESSAGES_ES.ALREADY_STARTED;
  if (code.includes("GAME") && code.includes("NOT") && code.includes("START")) return ERROR_MESSAGES_ES.GAME_NOT_STARTED;
  if (code.includes("GAME") && code.includes("NOT") && code.includes("END")) return ERROR_MESSAGES_ES.GAME_NOT_ENDED;
  if (code.includes("ALREADY EXISTS")) return "Ese dato ya existe. Prueba con otro valor.";
  if (code.includes("DUPLICATE KEY")) return "Ese dato ya existe. Prueba con otro valor.";
  if (code.includes("ALREADY IN ROOM")) return ERROR_MESSAGES_ES.ALREADY_IN_ROOM;
  if (code.includes("INVALID ROOM CODE")) return ERROR_MESSAGES_ES.INVALID_ROOM_CODE;
  if (code.includes("INVALID ROUNDS")) return ERROR_MESSAGES_ES.INVALID_ROUNDS;
  if (code.includes("INVALID NICKNAME")) return ERROR_MESSAGES_ES.INVALID_NICKNAME;
  if (code.includes("NOT FOUND")) return ERROR_MESSAGES_ES.NOT_FOUND;
  if (code.includes("NOT ALLOWED")) return ERROR_MESSAGES_ES.NOT_ALLOWED;
  if (code.includes("FORBIDDEN")) return ERROR_MESSAGES_ES.FORBIDDEN;
  if (code.includes("INVALID SESSION")) return ERROR_MESSAGES_ES.INVALID_SESSION;
  if (code.includes("NO SESSION")) return ERROR_MESSAGES_ES.SESSION_NOT_FOUND;
  if (code.includes("MISSING DEVICE")) return ERROR_MESSAGES_ES.MISSING_DEVICE_ID;
  if (code.includes("INVALID EMAIL")) return ERROR_MESSAGES_ES.INVALID_EMAIL;
  if (code.includes("TIMEOUT")) return "La solicitud tardo demasiado. Revisa tu conexión e intentalo de nuevo.";

  for (const [key, message] of Object.entries(ERROR_MESSAGES_ES)) {
    if (code.includes(key)) return message;
  }

  return toSpanishFallback(raw);
}

export function subscribeErrorModal(listener: ErrorModalListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function showErrorModal(
  value: string | null | undefined,
  title = "Aviso"
): void {
  const message = normalizeErrorMessage(value);
  const now = Date.now();
  const key = `${title}::${message}`;

  // Avoid duplicated popups when polling retries fail with same error.
  if (lastShownKey === key && now - lastShownAt < 1200) return;
  lastShownKey = key;
  lastShownAt = now;

  const payload: ErrorModalPayload = { title, message };
  listeners.forEach((listener) => listener(payload));
}
