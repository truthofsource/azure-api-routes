// Small public error adapter; the full employee/store module is outside this reference.
export class EmployeeProfileError extends Error {
  status:number;
  code:string;
  constructor(status:number, code:string, message:string) { super(message); this.status=status; this.code=code; }
}
export const employeeIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
