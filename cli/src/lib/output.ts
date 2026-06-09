export function success(msg: string): void {
  console.log(msg);
}

export function info(msg: string): void {
  console.error(msg);
}

export function error(msg: string): void {
  console.error(`Error: ${msg}`);
}
