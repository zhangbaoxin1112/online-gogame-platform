const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// 注册验证规则
const registerValidation = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage('用户名长度需要在3-20个字符之间')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('用户名只能包含字母、数字和下划线'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('密码长度至少为6个字符'),
  body('nickname')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('昵称长度不能超过50个字符')
];

// 登录验证规则
const loginValidation = [
  body('username').trim().notEmpty().withMessage('请输入用户名'),
  body('password').notEmpty().withMessage('请输入密码')
];

// 注册
router.post('/register', registerValidation, async (req, res) => {
  try {
    // 验证输入
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()[0].msg
      });
    }

    const { username, password, nickname } = req.body;

    // 检查用户名是否已存在
    const [existingUsers] = await pool.query(
      'SELECT id FROM users WHERE username = ?',
      [username]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({
        success: false,
        message: '用户名已被注册'
      });
    }

    // 加密密码
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 创建用户
    const [result] = await pool.query(
      'INSERT INTO users (username, password_hash, nickname) VALUES (?, ?, ?)',
      [username, passwordHash, nickname || username]
    );

    // 生成JWT，包含token_version用于验证
    const token = jwt.sign(
      { userId: result.insertId, tokenVersion: 0 },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.status(201).json({
      success: true,
      message: '注册成功',
      data: {
        token,
        user: {
          id: result.insertId,
          username,
          nickname: nickname || username,
          score: 100  // 新用户初始积分100
        }
      }
    });

  } catch (error) {
    console.error('注册错误:', error);
    res.status(500).json({
      success: false,
      message: '注册失败，请稍后重试'
    });
  }
});

// 登录
router.post('/login', loginValidation, async (req, res) => {
  try {
    // 验证输入
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()[0].msg
      });
    }

    const { username, password } = req.body;
    console.log('登录请求 - 用户名:', username, '密码长度:', password?.length);

    // 查找用户
    const [users] = await pool.query(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );

    console.log('查询结果 - 找到用户数:', users.length);

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: '用户名或密码错误'
      });
    }

    const user = users[0];
    console.log('用户信息 - ID:', user.id, '哈希存在:', !!user.password_hash, '哈希长度:', user.password_hash?.length);

    // 验证密码
    const isMatch = await bcrypt.compare(password, user.password_hash);
    console.log('密码验证结果:', isMatch);
    
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: '用户名或密码错误'
      });
    }

    // 注意：不在这里更新在线状态，在线状态完全由Socket连接管理
    // 更新最后登录时间
    await pool.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

    // 生成JWT，包含token_version用于验证
    const token = jwt.sign(
      { userId: user.id, tokenVersion: user.token_version || 0 },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      success: true,
      message: '登录成功',
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          nickname: user.nickname,
          avatar: user.avatar,
          score: user.score,
          region: user.region,
          birthday: user.birthday,
          total_games: user.total_games,
          win_games: user.win_games,
          created_at: user.created_at
        }
      }
    });

  } catch (error) {
    console.error('登录错误:', error);
    res.status(500).json({
      success: false,
      message: '登录失败，请稍后重试'
    });
  }
});

// 登出
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    // 更新用户状态为离线，并递增token_version使所有旧token失效
    await pool.query(
      'UPDATE users SET status = ?, token_version = token_version + 1 WHERE id = ?', 
      ['offline', req.user.id]
    );

    res.json({
      success: true,
      message: '登出成功'
    });
  } catch (error) {
    console.error('登出错误:', error);
    res.status(500).json({
      success: false,
      message: '登出失败'
    });
  }
});

// 验证Token
router.get('/verify', authMiddleware, async (req, res) => {
  res.json({
    success: true,
    data: {
      user: req.user
    }
  });
});

module.exports = router;
