import app from '../src/server.js';

export default function handler(req, res) {
  if (req.headers['x-matched-path'] && !req.headers['x-matched-path'].includes('api/index')) {
    req.url = req.headers['x-matched-path'];
  }
  return app(req, res);
}
