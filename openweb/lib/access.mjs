// Who may use the hosted app. A server reached through a share link or a hosting proxy must have a login password, unless
// its owner has deliberately set OPEN_ACCESS=1 — then anyone with the address can use it (and its AI key's quota).
// Settings (keys) can still only be changed on the computer running the app, whatever this returns.
/**
 * @param {{ viaShare: boolean, appPassword?: string, pw?: string, openAccess?: boolean }} o
 * @returns {"open"|"locked"|"login"} open: no login needed · locked: no password is set and open access is off · login: ask for the password
 */
export function accessMode({ viaShare, appPassword, pw, openAccess = false }) {
  if (!(viaShare || appPassword)) return "open";   // you, on the computer running the app
  if (pw) return "login";
  return openAccess ? "open" : "locked";
}
