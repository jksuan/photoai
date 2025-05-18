declare namespace Express {
    interface Request {
        userId?: string;
        rawBody?: string | Buffer;
    }
}