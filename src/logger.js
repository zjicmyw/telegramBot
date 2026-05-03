import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

if (!['production', 'test'].includes(process.env.NODE_ENV)) {
  logger.add(
    new winston.transports.Console({
      format: winston.format.simple()
    })
  );
}

export { logger };
