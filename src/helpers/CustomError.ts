class CustomError<T = unknown> extends Error {
  statusCode: number;
  status: "client Error" | "server Error";
  isOperationalError: boolean;
  data?: T | undefined;

  constructor(statusCode: number, message: string, data?: T) {
    super(message);

    this.statusCode = statusCode;
    this.status =
      statusCode >= 400 && statusCode < 500 ? "client Error" : "server Error";

    this.isOperationalError =
      statusCode >= 400 && statusCode < 500 ? false : true;

    this.data = data;

    // Fix prototype chain (important for instanceof checks)
    Object.setPrototypeOf(this, new.target.prototype);

    // Capture stack trace (Node.js only)
    Error.captureStackTrace(this, this.constructor);
  }
}

export default CustomError;
