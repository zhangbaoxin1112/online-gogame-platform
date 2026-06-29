require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

// 导入路由
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const gameRoutes = require('./routes/game');
const rankRoutes = require('./routes/rank');
const friendRoutes = require('./routes/friend');
const llmRoutes = require('./routes/llm');

// 导入Socket处理器
const setupSocketHandlers = require('./socket');

const app = express();
const server = http.createServer(app);

// Socket.io配置
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true
  },
  // 增加超时时间，适应移动端后台切换（如选择照片、切换应用等）
  // 选择照片可能需要1-2分钟，所以设置更长的超时
  pingTimeout: 180000,     // 3分钟无响应才认为断开
  pingInterval: 60000,     // 每60秒发送一次心跳
  connectTimeout: 60000    // 连接超时60秒
});

// 中间件
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静态文件（头像等）
app.use('/uploads', express.static('uploads'));

// API路由
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/rank', rankRoutes);
app.use('/api/friend', friendRoutes);
app.use('/api/llm', llmRoutes);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: '服务器运行正常' });
});

// 设置Socket.io处理器
setupSocketHandlers(io);

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    success: false, 
    message: '服务器内部错误',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404处理
app.use((req, res) => {
  res.status(404).json({ success: false, message: '接口不存在' });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`🎮 围棋服务器运行在端口 ${PORT}`);
  console.log(`📡 WebSocket服务已启动`);
});

module.exports = { app, server, io };
