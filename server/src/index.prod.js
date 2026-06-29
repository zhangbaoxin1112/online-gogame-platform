/**
 * 生产环境入口文件
 * - 使用SQLite数据库（无需外部数据库）
 * - 托管前端静态文件
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

// 强制使用SQLite
process.env.USE_SQLITE = 'true';

// 导入路由
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const gameRoutes = require('./routes/game');
const rankRoutes = require('./routes/rank');

// 导入Socket处理器
const setupSocketHandlers = require('./socket');

const app = express();
const server = http.createServer(app);

// 获取端口
const PORT = process.env.PORT || 80;

// Socket.io配置 - 生产环境
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  // 增加超时时间
  pingTimeout: 60000,
  pingInterval: 25000
});

// 中间件
app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静态文件（头像等）
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// API路由
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/rank', rankRoutes);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: '服务器运行正常', time: new Date().toISOString() });
});

// 设置Socket.io处理器
setupSocketHandlers(io);

// ============ 托管前端静态文件 ============
const clientDistPath = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDistPath));

// 所有非API请求都返回index.html（SPA路由支持）
app.get('*', (req, res, next) => {
  // 如果是API请求，跳过
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
    return next();
  }
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    success: false, 
    message: '服务器内部错误'
  });
});

// 404处理
app.use((req, res) => {
  res.status(404).json({ success: false, message: '接口不存在' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎮 围棋服务器运行在端口 ${PORT}`);
  console.log(`📡 WebSocket服务已启动`);
  console.log(`🌐 访问地址: http://0.0.0.0:${PORT}`);
});

module.exports = { app, server, io };
