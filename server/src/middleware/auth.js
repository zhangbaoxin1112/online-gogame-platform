const jwt = require('jsonwebtoken');
const pool = require('../config/database');

// JWT认证中间件
const authMiddleware = async (req, res, next) => {
  try {
    // 从请求头获取token
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: '未提供认证令牌'
      });
    }

    const token = authHeader.substring(7); // 移除 "Bearer " 前缀

    // 验证token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // 查询用户是否存在（包含完整的用户信息和token_version）
    const [users] = await pool.query(
      `SELECT id, username, nickname, avatar, score, status, region, birthday, 
              total_games, win_games, created_at, token_version FROM users WHERE id = ?`,
      [decoded.userId]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: '用户不存在'
      });
    }

    const user = users[0];

    // 检查token_version是否匹配（用于实现安全登出）
    // 如果用户已登出，token_version会递增，旧token中的版本号将不匹配
    const tokenVersion = decoded.tokenVersion || 0;
    const currentVersion = user.token_version || 0;
    if (tokenVersion < currentVersion) {
      return res.status(401).json({
        success: false,
        message: '登录已失效，请重新登录'
      });
    }

    // 将用户信息添加到请求对象（不包含token_version）
    delete user.token_version;
    req.user = user;
    next();

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: '无效的认证令牌'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: '认证令牌已过期'
      });
    }
    
    console.error('认证中间件错误:', error);
    return res.status(500).json({
      success: false,
      message: '认证失败'
    });
  }
};

// 可选认证中间件（不强制要求登录）
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      const [users] = await pool.query(
        `SELECT id, username, nickname, avatar, score, status, region, birthday, 
                total_games, win_games, created_at FROM users WHERE id = ?`,
        [decoded.userId]
      );

      if (users.length > 0) {
        req.user = users[0];
      }
    }
    
    next();
  } catch (error) {
    // 即使token无效也继续执行
    next();
  }
};

module.exports = { authMiddleware, optionalAuth };
