const express = require('express');
const pool = require('../config/database');
const { authMiddleware, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// 获取对局详情
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const [games] = await pool.query(
      `SELECT g.*, 
              bp.nickname as black_player_name, bp.avatar as black_player_avatar, bp.score as black_player_score,
              wp.nickname as white_player_name, wp.avatar as white_player_avatar, wp.score as white_player_score,
              w.nickname as winner_name
       FROM games g
       LEFT JOIN users bp ON g.black_player_id = bp.id
       LEFT JOIN users wp ON g.white_player_id = wp.id
       LEFT JOIN users w ON g.winner_id = w.id
       WHERE g.id = ?`,
      [req.params.id]
    );

    if (games.length === 0) {
      return res.status(404).json({
        success: false,
        message: '对局不存在'
      });
    }

    res.json({
      success: true,
      data: { game: games[0] }
    });

  } catch (error) {
    console.error('获取对局详情错误:', error);
    res.status(500).json({
      success: false,
      message: '获取对局详情失败'
    });
  }
});

// 创建人机对战对局
router.post('/pve', authMiddleware, async (req, res) => {
  try {
    const { aiLevel = 'easy', boardSize = 19, playAsBlack = true } = req.body;

    // 验证参数
    if (!['easy', 'medium', 'hard'].includes(aiLevel)) {
      return res.status(400).json({
        success: false,
        message: '无效的AI难度等级'
      });
    }

    if (![9, 13, 19].includes(boardSize)) {
      return res.status(400).json({
        success: false,
        message: '无效的棋盘大小'
      });
    }

    // 创建对局记录
    const [result] = await pool.query(
      `INSERT INTO games (black_player_id, white_player_id, game_type, ai_level, board_size, moves_record, status)
       VALUES (?, ?, 'pve', ?, ?, '[]', 'playing')`,
      [
        playAsBlack ? req.user.id : null,
        playAsBlack ? null : req.user.id,
        aiLevel,
        boardSize
      ]
    );

    res.status(201).json({
      success: true,
      message: '人机对局创建成功',
      data: {
        gameId: result.insertId,
        aiLevel,
        boardSize,
        playAsBlack
      }
    });

  } catch (error) {
    console.error('创建人机对局错误:', error);
    res.status(500).json({
      success: false,
      message: '创建对局失败'
    });
  }
});

// 保存人机对战结果
router.put('/pve/:id/finish', authMiddleware, async (req, res) => {
  try {
    const { winnerId, movesRecord, result: gameResult, duration } = req.body;
    const gameId = req.params.id;

    // 验证对局是否存在且属于当前用户
    const [games] = await pool.query(
      `SELECT * FROM games WHERE id = ? AND game_type = 'pve' AND 
       (black_player_id = ? OR white_player_id = ?)`,
      [gameId, req.user.id, req.user.id]
    );

    if (games.length === 0) {
      return res.status(404).json({
        success: false,
        message: '对局不存在或无权操作'
      });
    }

    // 更新对局记录
    await pool.query(
      `UPDATE games SET winner_id = ?, moves_record = ?, result = ?, 
       duration = ?, status = 'finished', finished_at = NOW() WHERE id = ?`,
      [winnerId, JSON.stringify(movesRecord), gameResult, duration, gameId]
    );

    // 计算积分变动
    let scoreDelta = 0;
    const game = games[0];
    // 人机博弈积分规则：初级+10，中级+20，高级+30，输了不扣分
    const aiLevelScores = { easy: 10, medium: 20, hard: 30 };

    if (winnerId === req.user.id) {
      // 玩家获胜才加分
      scoreDelta = aiLevelScores[game.ai_level] || 10;
    }
    // AI获胜（玩家输了）不扣分
    // 平局不变动积分

    if (scoreDelta !== 0) {
      // 更新用户积分
      await pool.query(
        `UPDATE users SET score = score + ?, total_games = total_games + 1,
         win_games = win_games + ? WHERE id = ?`,
        [scoreDelta, winnerId === req.user.id ? 1 : 0, req.user.id]
      );

      // 获取新积分
      const [userResult] = await pool.query(
        'SELECT score FROM users WHERE id = ?',
        [req.user.id]
      );

      // 记录积分变动（只有赢了才会有积分变动）
      await pool.query(
        `INSERT INTO score_logs (user_id, delta, new_score, reason, game_id)
         VALUES (?, ?, ?, ?, ?)`,
        [
          req.user.id,
          scoreDelta,
          userResult[0].score,
          `人机对战(${game.ai_level})胜利`,
          gameId
        ]
      );
    } else {
      // 平局或输了只更新对局数，不变动积分
      await pool.query(
        `UPDATE users SET total_games = total_games + 1,
         win_games = win_games + ? WHERE id = ?`,
        [winnerId === req.user.id ? 1 : 0, req.user.id]
      );
    }

    res.json({
      success: true,
      message: '对局结果保存成功',
      data: { scoreDelta }
    });

  } catch (error) {
    console.error('保存对局结果错误:', error);
    res.status(500).json({
      success: false,
      message: '保存对局结果失败'
    });
  }
});

// 获取最近对局列表
router.get('/', optionalAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const gameType = req.query.type; // pvp 或 pve
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE g.status = "finished"';
    const params = [];

    if (gameType) {
      whereClause += ' AND g.game_type = ?';
      params.push(gameType);
    }

    const [games] = await pool.query(
      `SELECT g.id, g.game_type, g.ai_level, g.board_size, g.result, g.duration, g.created_at,
              bp.nickname as black_player_name, bp.avatar as black_player_avatar,
              wp.nickname as white_player_name, wp.avatar as white_player_avatar,
              w.nickname as winner_name
       FROM games g
       LEFT JOIN users bp ON g.black_player_id = bp.id
       LEFT JOIN users wp ON g.white_player_id = wp.id
       LEFT JOIN users w ON g.winner_id = w.id
       ${whereClause}
       ORDER BY g.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      success: true,
      data: { games }
    });

  } catch (error) {
    console.error('获取对局列表错误:', error);
    res.status(500).json({
      success: false,
      message: '获取对局列表失败'
    });
  }
});

module.exports = router;
