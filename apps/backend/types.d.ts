declare namespace Express {
    interface Request {
        userId?: string;
        rawBody?: string | Buffer;  // 新增：存储请求的原始主体数据，用于stripe支付webhook验证
    }
}