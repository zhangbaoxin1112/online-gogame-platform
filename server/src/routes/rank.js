const express = require('express');
const pool = require('../config/database');

const router = express.Router();

// 获取积分排行榜
router.get('/leaderboard', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const page = parseInt(req.query.page) || 1;
    const offset = (page - 1) * limit;

    // 使用子查询计算排名，避免RANK()窗口函数在旧版MySQL的兼容性问题
    const [users] = await pool.query(
      `SELECT id, username, nickname, avatar, score, total_games, win_games
       FROM users
       ORDER BY score DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    // 计算胜率和排名
    const rankedUsers = users.map((user, index) => ({
      ...user,
      rank: offset + index + 1,
      win_rate: user.total_games > 0 
        ? Math.round((user.win_games / user.total_games) * 100) 
        : 0
    }));

    // 获取总用户数
    const [countResult] = await pool.query('SELECT COUNT(*) as total FROM users');

    res.json({
      success: true,
      data: {
        users: rankedUsers,
        pagination: {
          page,
          limit,
          total: countResult[0].total,
          totalPages: Math.ceil(countResult[0].total / limit)
        }
      }
    });

  } catch (error) {
    console.error('获取排行榜错误:', error);
    res.status(500).json({
      success: false,
      message: '获取排行榜失败'
    });
  }
});

// 获取用户排名
router.get('/user/:id', async (req, res) => {
  try {
    const userId = req.params.id;

    // 获取用户信息和排名 (rank是MySQL保留字，需要用反引号)
    const [result] = await pool.query(
      `SELECT u.*, 
              (SELECT COUNT(*) + 1 FROM users WHERE score > u.score) as \`rank\`
       FROM users u
       WHERE u.id = ?`,
      [userId]
    );

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    const user = result[0];
    user.win_rate = user.total_games > 0 
      ? Math.round((user.win_games / user.total_games) * 100) 
      : 0;

    res.json({
      success: true,
      data: {
        rank: user.rank,
        score: user.score,
        total_games: user.total_games,
        win_games: user.win_games,
        win_rate: user.win_rate
      }
    });

  } catch (error) {
    console.error('获取用户排名错误:', error);
    res.status(500).json({
      success: false,
      message: '获取用户排名失败'
    });
  }
});

// 获取今日排行榜（基于今日积分变动）
router.get('/daily', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;

    const [users] = await pool.query(
      `SELECT u.id, u.nickname, u.avatar, u.score,
              COALESCE(SUM(sl.delta), 0) as daily_score_change
       FROM users u
       LEFT JOIN score_logs sl ON u.id = sl.user_id 
         AND DATE(sl.created_at) = CURDATE()
       GROUP BY u.id
       HAVING daily_score_change > 0
       ORDER BY daily_score_change DESC
       LIMIT ?`,
      [limit]
    );

    res.json({
      success: true,
      data: { users }
    });

  } catch (error) {
    console.error('获取今日排行榜错误:', error);
    res.status(500).json({
      success: false,
      message: '获取今日排行榜失败'
    });
  }
});

// 获取统计数据
router.get('/stats', async (req, res) => {
  try {
    // 获取总用户数
    const [userCount] = await pool.query('SELECT COUNT(*) as count FROM users');
    
    // 获取今日活跃用户数（基于最近登录时间或今日有对局的用户）
    const [activeUsers] = await pool.query(
      `SELECT COUNT(*) as count FROM users 
       WHERE DATE(last_login) = CURDATE() 
       OR id IN (SELECT DISTINCT black_player_id FROM games WHERE DATE(created_at) = CURDATE())
       OR id IN (SELECT DISTINCT white_player_id FROM games WHERE DATE(created_at) = CURDATE() AND white_player_id IS NOT NULL)`
    );
    
    // 获取总对局数
    const [gameCount] = await pool.query(
      `SELECT COUNT(*) as count FROM games WHERE status = 'finished'`
    );
    
    // 获取今日对局数
    const [todayGames] = await pool.query(
      `SELECT COUNT(*) as count FROM games 
       WHERE status = 'finished' AND DATE(created_at) = CURDATE()`
    );

    res.json({
      success: true,
      data: {
        totalUsers: userCount[0].count,
        activeUsersToday: activeUsers[0].count,
        totalGames: gameCount[0].count,
        todayGames: todayGames[0].count
      }
    });

  } catch (error) {
    console.error('获取统计数据错误:', error);
    res.status(500).json({
      success: false,
      message: '获取统计数据失败'
    });
  }
});

module.exports = router;
