const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const pool = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// 配置头像上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/avatars/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `avatar-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('只允许上传图片文件'));
  }
});

// 获取当前用户信息
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const [users] = await pool.query(
      `SELECT id, username, nickname, region, birthday, avatar, score, 
              total_games, win_games, status, created_at 
       FROM users WHERE id = ?`,
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    const user = users[0];
    // 计算胜率
    user.win_rate = user.total_games > 0 
      ? Math.round((user.win_games / user.total_games) * 100) 
      : 0;

    res.json({
      success: true,
      data: { user }
    });

  } catch (error) {
    console.error('获取用户信息错误:', error);
    res.status(500).json({
      success: false,
      message: '获取用户信息失败'
    });
  }
});

// 获取指定用户信息（公开信息）
router.get('/:id', async (req, res) => {
  try {
    const [users] = await pool.query(
      `SELECT id, username, nickname, region, avatar, score, 
              total_games, win_games, created_at 
       FROM users WHERE id = ?`,
      [req.params.id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    const user = users[0];
    user.win_rate = user.total_games > 0 
      ? Math.round((user.win_games / user.total_games) * 100) 
      : 0;

    res.json({
      success: true,
      data: { user }
    });

  } catch (error) {
    console.error('获取用户信息错误:', error);
    res.status(500).json({
      success: false,
      message: '获取用户信息失败'
    });
  }
});

// 更新用户资料验证规则
const updateProfileValidation = [
  body('nickname')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('昵称长度需要在1-50个字符之间'),
  body('region')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('地区长度不能超过100个字符'),
  body('birthday')
    .optional()
    .isISO8601()
    .withMessage('生日格式不正确')
];

// 更新用户资料
router.put('/profile', authMiddleware, updateProfileValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()[0].msg
      });
    }

    const { nickname, region, birthday } = req.body;
    const updateFields = [];
    const updateValues = [];

    if (nickname !== undefined) {
      updateFields.push('nickname = ?');
      updateValues.push(nickname);
    }
    if (region !== undefined) {
      updateFields.push('region = ?');
      updateValues.push(region);
    }
    if (birthday !== undefined) {
      updateFields.push('birthday = ?');
      updateValues.push(birthday);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: '没有需要更新的字段'
      });
    }

    updateValues.push(req.user.id);

    await pool.query(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    // 获取更新后的用户信息
    const [users] = await pool.query(
      `SELECT id, username, nickname, region, birthday, avatar, score, 
              total_games, win_games 
       FROM users WHERE id = ?`,
      [req.user.id]
    );

    res.json({
      success: true,
      message: '资料更新成功',
      data: { user: users[0] }
    });

  } catch (error) {
    console.error('更新用户资料错误:', error);
    res.status(500).json({
      success: false,
      message: '更新资料失败'
    });
  }
});

// 上传头像
router.post('/avatar', authMiddleware, (req, res, next) => {
  upload.single('avatar')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message || '头像上传失败'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: '请选择要上传的头像'
      });
    }

    try {
      const avatarPath = `/uploads/avatars/${req.file.filename}`;
      
      await pool.query(
        'UPDATE users SET avatar = ? WHERE id = ?',
        [avatarPath, req.user.id]
      );

      res.json({
        success: true,
        message: '头像上传成功',
        data: { avatar: avatarPath }
      });

    } catch (error) {
      console.error('头像上传错误:', error);
      res.status(500).json({
        success: false,
        message: '头像上传失败'
      });
    }
  });
});

// 修改密码
router.put('/password', authMiddleware, [
  body('oldPassword').notEmpty().withMessage('请输入当前密码'),
  body('newPassword').isLength({ min: 6 }).withMessage('新密码长度至少为6个字符')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()[0].msg
      });
    }

    const { oldPassword, newPassword } = req.body;

    // 获取用户当前密码
    const [users] = await pool.query(
      'SELECT password_hash FROM users WHERE id = ?',
      [req.user.id]
    );

    // 验证旧密码
    const isMatch = await bcrypt.compare(oldPassword, users[0].password_hash);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: '当前密码错误'
      });
    }

    // 加密新密码
    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);

    // 更新密码
    await pool.query(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [newPasswordHash, req.user.id]
    );

    res.json({
      success: true,
      message: '密码修改成功'
    });

  } catch (error) {
    console.error('修改密码错误:', error);
    res.status(500).json({
      success: false,
      message: '修改密码失败'
    });
  }
});

// 获取用户对局历史
router.get('/games/history', authMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const [games] = await pool.query(
      `SELECT g.*, 
              bp.nickname as black_player_name, bp.avatar as black_player_avatar,
              wp.nickname as white_player_name, wp.avatar as white_player_avatar,
              w.nickname as winner_name
       FROM games g
       LEFT JOIN users bp ON g.black_player_id = bp.id
       LEFT JOIN users wp ON g.white_player_id = wp.id
       LEFT JOIN users w ON g.winner_id = w.id
       WHERE g.black_player_id = ? OR g.white_player_id = ?
       ORDER BY g.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.user.id, req.user.id, limit, offset]
    );

    // 获取总数
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM games 
       WHERE black_player_id = ? OR white_player_id = ?`,
      [req.user.id, req.user.id]
    );

    res.json({
      success: true,
      data: {
        games,
        pagination: {
          page,
          limit,
          total: countResult[0].total,
          totalPages: Math.ceil(countResult[0].total / limit)
        }
      }
    });

  } catch (error) {
    console.error('获取对局历史错误:', error);
    res.status(500).json({
      success: false,
      message: '获取对局历史失败'
    });
  }
});

// 获取积分变动记录
router.get('/score/logs', authMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const [logs] = await pool.query(
      `SELECT * FROM score_logs 
       WHERE user_id = ? 
       ORDER BY created_at DESC 
       LIMIT ? OFFSET ?`,
      [req.user.id, limit, offset]
    );

    res.json({
      success: true,
      data: { logs }
    });

  } catch (error) {
    console.error('获取积分记录错误:', error);
    res.status(500).json({
      success: false,
      message: '获取积分记录失败'
    });
  }
});

module.exports = router;
