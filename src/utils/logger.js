import winston from 'winston';
import { config } from '../config/env.js';

const isServerless = Boolean(process.env.VERCEL || process.env.VERCEL_SERVERLESS || process.env.AWS_LAMBDA_FUNCTION_NAME);

const transports = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const { service, ...restMeta } = meta;
        const metaStr = Object.keys(restMeta).length > 0
          ? JSON.stringify(restMeta) 
          : '';
        return `[${timestamp}] [${level}]: ${message} ${metaStr}`.trimEnd();
      })
    ),
  }),
];

if (!isServerless) {
  transports.push(
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  );
}

export const logger = winston.createLogger({
  level: config.env === 'development' ? 'debug' : 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'outreach-backend' },
  transports,
});
