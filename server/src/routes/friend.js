const express = require('express');
const pool = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// 获取好友列表
router.get('/list', authMiddleware, async (req, res) => {
  try {
    const [friends] = await pool.query(`
      SELECT u.id, u.username, u.nickname, u.avatar, u.score, u.status, u.total_games, u.win_games
      FROM friends f
      JOIN users u ON f.friend_id = u.id
      WHERE f.user_id = ?
      ORDER BY u.status = 'online' DESC, u.nickname ASC
    `, [req.user.id]);

    res.json({
      success: true,
      data: { friends }
    });
  } catch (error) {
    console.error('获取好友列表错误:', error);
    res.status(500).json({
      success: false,
      message: '获取好友列表失败'
    });
  }
});

// 搜索用户（按用户名）
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { username } = req.query;
    
    if (!username || username.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: '请输入用户名'
      });
    }

    const [users] = await pool.query(`
      SELECT u.id, u.username, u.nickname, u.avatar, u.score,
             CASE 
               WHEN f.id IS NOT NULL THEN 'friend'
               WHEN fr.id IS NOT NULL AND fr.status = 'pending' THEN 'pending'
               ELSE 'none'
             END as relationship
      FROM users u
      LEFT JOIN friends f ON f.user_id = ? AND f.friend_id = u.id
      LEFT JOIN friend_requests fr ON fr.from_user_id = ? AND fr.to_user_id = u.id AND fr.status = 'pending'
      WHERE u.username LIKE ? AND u.id != ?
      LIMIT 10
    `, [req.user.id, req.user.id, `%${username}%`, req.user.id]);

    res.json({
      success: true,
      data: { users }
    });
  } catch (error) {
    console.error('搜索用户错误:', error);
    res.status(500).json({
      success: false,
      message: '搜索用户失败'
    });
  }
});

// 发送好友请求
router.post('/request', authMiddleware, async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({
        success: false,
        message: '请输入用户名'
      });
    }

    // 查找目标用户
    const [users] = await pool.query(
      'SELECT id, username, nickname FROM users WHERE username = ?',
      [username]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    const targetUser = users[0];

    if (targetUser.id === req.user.id) {
      return res.status(400).json({
        success: false,
        message: '不能添加自己为好友'
      });
    }

    // 检查是否已经是好友
    const [existingFriend] = await pool.query(
      'SELECT id FROM friends WHERE user_id = ? AND friend_id = ?',
      [req.user.id, targetUser.id]
    );

    if (existingFriend.length > 0) {
      return res.status(400).json({
        success: false,
        message: '该用户已经是你的好友'
      });
    }

    // 检查是否已有待处理的请求
    const [existingRequest] = await pool.query(
      'SELECT id, status FROM friend_requests WHERE from_user_id = ? AND to_user_id = ?',
      [req.user.id, targetUser.id]
    );

    if (existingRequest.length > 0) {
      if (existingRequest[0].status === 'pending') {
        return res.status(400).json({
          success: false,
          message: '已发送过好友请求，请等待对方处理'
        });
      }
      // 如果之前被拒绝，更新为pending
      await pool.query(
        'UPDATE friend_requests SET status = "pending", created_at = NOW() WHERE id = ?',
        [existingRequest[0].id]
      );
    } else {
      // 检查对方是否已经向你发送请求
      const [reverseRequest] = await pool.query(
        'SELECT id FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = "pending"',
        [targetUser.id, req.user.id]
      );

      if (reverseRequest.length > 0) {
        // 对方已经发送请求，直接同意
        await pool.query(
          'UPDATE friend_requests SET status = "accepted" WHERE id = ?',
          [reverseRequest[0].id]
        );

        // 建立双向好友关系
        await pool.query(
          'INSERT INTO friends (user_id, friend_id) VALUES (?, ?), (?, ?)',
          [req.user.id, targetUser.id, targetUser.id, req.user.id]
        );

        return res.json({
          success: true,
          message: '对方已向你发送请求，已自动添加为好友'
        });
      }

      // 创建新请求
      await pool.query(
        'INSERT INTO friend_requests (from_user_id, to_user_id) VALUES (?, ?)',
        [req.user.id, targetUser.id]
      );
    }

    res.json({
      success: true,
      message: '好友请求已发送'
    });
  } catch (error) {
    console.error('发送好友请求错误:', error);
    res.status(500).json({
      success: false,
      message: '发送好友请求失败'
    });
  }
});

// 获取收到的好友请求列表
router.get('/requests', authMiddleware, async (req, res) => {
  try {
    const [requests] = await pool.query(`
      SELECT fr.id, fr.from_user_id, fr.status, fr.created_at,
             u.username, u.nickname, u.avatar, u.score
      FROM friend_requests fr
      JOIN users u ON fr.from_user_id = u.id
      WHERE fr.to_user_id = ? AND fr.status = 'pending'
      ORDER BY fr.created_at DESC
    `, [req.user.id]);

    res.json({
      success: true,
      data: { requests }
    });
  } catch (error) {
    console.error('获取好友请求错误:', error);
    res.status(500).json({
      success: false,
      message: '获取好友请求失败'
    });
  }
});

// 处理好友请求（接受/拒绝）
router.put('/request/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // 'accept' or 'reject'

    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: '无效的操作'
      });
    }

    // 验证请求是否存在且是发给当前用户的
    const [requests] = await pool.query(
      'SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ? AND status = "pending"',
      [id, req.user.id]
    );

    if (requests.length === 0) {
      return res.status(404).json({
        success: false,
        message: '好友请求不存在或已处理'
      });
    }

    const request = requests[0];
    const newStatus = action === 'accept' ? 'accepted' : 'rejected';

    // 更新请求状态
    await pool.query(
      'UPDATE friend_requests SET status = ? WHERE id = ?',
      [newStatus, id]
    );

    // 如果接受，建立双向好友关系
    if (action === 'accept') {
      await pool.query(
        'INSERT INTO friends (user_id, friend_id) VALUES (?, ?), (?, ?) ON DUPLICATE KEY UPDATE user_id = user_id',
        [req.user.id, request.from_user_id, request.from_user_id, req.user.id]
      );
    }

    res.json({
      success: true,
      message: action === 'accept' ? '已添加为好友' : '已拒绝好友请求'
    });
  } catch (error) {
    console.error('处理好友请求错误:', error);
    res.status(500).json({
      success: false,
      message: '处理好友请求失败'
    });
  }
});

// 删除好友
router.delete('/:friendId', authMiddleware, async (req, res) => {
  try {
    const { friendId } = req.params;

    // 删除双向好友关系
    await pool.query(
      'DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
      [req.user.id, friendId, friendId, req.user.id]
    );

    res.json({
      success: true,
      message: '已删除好友'
    });
  } catch (error) {
    console.error('删除好友错误:', error);
    res.status(500).json({
      success: false,
      message: '删除好友失败'
    });
  }
});

module.exports = router;
