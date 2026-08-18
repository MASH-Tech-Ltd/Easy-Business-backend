import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import routes from './routes/index';
import { globalErrorHandler } from './helpers/globalErrorHandler';
import { notFound } from './middleware/notFound';
import config from './config/index';

const app: Application = express();

const allowedOrigins = [config.frontendUrl, 'http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://localhost:5173', 'http://localhost:5174'];
app.use(cors({ 
  origin: (origin, callback) => {
    // Allow all origins for local development to prevent port mismatch errors
    callback(null, true);
  }, 
  credentials: true 
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan(config.env === 'development' ? 'dev' : 'short'));

import { tenantMiddleware } from './middleware/tenant.middleware';

// Routes
app.use('/api/v1', tenantMiddleware, routes);

// Health check endpoint
app.get('/ping', (req: Request, res: Response) => {
  res.status(200).json({ message: 'pong', time: new Date() });
});

// Not Found Middleware
app.use(notFound);

// Global Error Handler
app.use(globalErrorHandler);

export default app;
