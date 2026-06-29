require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mysql = require('mysql2/promise');

const initDatabase = async () => {
  // 首先连接MySQL（不指定数据库）
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || ''
  });

  const dbName = process.env.DB_NAME || 'go_game';

  try {
    // 创建数据库
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log(`✅ 数据库 ${dbName} 创建成功或已存在`);

    // 使用该数据库
    await connection.query(`USE \`${dbName}\``);

    // 创建用户表
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT PRIMARY KEY AUTO_INCREMENT,
        username VARCHAR(50) UNIQUE NOT NULL COMMENT '用户名',
        password_hash VARCHAR(255) NOT NULL COMMENT '密码哈希',
        nickname VARCHAR(50) COMMENT '昵称',
        region VARCHAR(100) COMMENT '地区',
        birthday DATE COMMENT '生日',
        avatar VARCHAR(255) DEFAULT '/uploads/default-avatar.png' COMMENT '头像路径',
        score INT DEFAULT 100 COMMENT '积分（新用户100分）',
        total_games INT DEFAULT 0 COMMENT '总对局数',
        win_games INT DEFAULT 0 COMMENT '胜局数',
        status ENUM('online', 'offline', 'playing', 'matching') DEFAULT 'offline' COMMENT '用户状态',
        token_version INT DEFAULT 0 COMMENT 'Token版本号，用于使旧token失效',
        last_login TIMESTAMP NULL COMMENT '最后登录时间',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        INDEX idx_score (score DESC),
        INDEX idx_username (username)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表'
    `);
    console.log('✅ 用户表创建成功');

    // 创建对局记录表
    await connection.query(`
      CREATE TABLE IF NOT EXISTS games (
        id INT PRIMARY KEY AUTO_INCREMENT,
        black_player_id INT COMMENT '黑方玩家ID',
        white_player_id INT COMMENT '白方玩家ID',
        winner_id INT COMMENT '获胜者ID（null表示平局或未结束）',
        game_type ENUM('pvp', 'pve') NOT NULL COMMENT '对局类型：pvp-玩家对战, pve-人机对战',
        match_mode ENUM('random', 'friend', 'normal', 'easy', 'hard') DEFAULT NULL COMMENT 'PVP匹配模式',
        ai_level ENUM('easy', 'medium', 'hard') COMMENT 'AI难度等级',
        board_size INT DEFAULT 19 COMMENT '棋盘大小',
        moves_record JSON COMMENT '棋谱记录',
        result VARCHAR(50) COMMENT '对局结果描述',
        duration INT COMMENT '对局时长（秒）',
        status ENUM('waiting', 'playing', 'finished', 'abandoned') DEFAULT 'waiting' COMMENT '对局状态',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        finished_at TIMESTAMP NULL COMMENT '结束时间',
        INDEX idx_black_player (black_player_id),
        INDEX idx_white_player (white_player_id),
        INDEX idx_game_type (game_type),
        INDEX idx_created_at (created_at DESC),
        FOREIGN KEY (black_player_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (white_player_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (winner_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对局记录表'
    `);
    console.log('✅ 对局记录表创建成功');

    // 创建积分变动记录表
    await connection.query(`
      CREATE TABLE IF NOT EXISTS score_logs (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL COMMENT '用户ID',
        delta INT NOT NULL COMMENT '积分变动值',
        new_score INT NOT NULL COMMENT '变动后积分',
        reason VARCHAR(255) NOT NULL COMMENT '变动原因',
        game_id INT COMMENT '关联的对局ID',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        INDEX idx_user_id (user_id),
        INDEX idx_created_at (created_at DESC),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='积分变动记录表'
    `);
    console.log('✅ 积分变动记录表创建成功');

    // 创建好友表
    await connection.query(`
      CREATE TABLE IF NOT EXISTS friends (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL COMMENT '用户ID',
        friend_id INT NOT NULL COMMENT '好友ID',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        UNIQUE KEY unique_friendship (user_id, friend_id),
        INDEX idx_user_id (user_id),
        INDEX idx_friend_id (friend_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='好友关系表'
    `);
    console.log('✅ 好友表创建成功');

    // 创建好友请求表
    await connection.query(`
      CREATE TABLE IF NOT EXISTS friend_requests (
        id INT PRIMARY KEY AUTO_INCREMENT,
        from_user_id INT NOT NULL COMMENT '发送请求的用户ID',
        to_user_id INT NOT NULL COMMENT '接收请求的用户ID',
        status ENUM('pending', 'accepted', 'rejected') DEFAULT 'pending' COMMENT '请求状态',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        UNIQUE KEY unique_request (from_user_id, to_user_id),
        INDEX idx_to_user (to_user_id),
        INDEX idx_status (status),
        FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='好友请求表'
    `);
    console.log('✅ 好友请求表创建成功');

    console.log('\n🎉 所有数据库表初始化完成！');

  } catch (error) {
    console.error('❌ 数据库初始化失败:', error.message);
    throw error;
  } finally {
    await connection.end();
  }
};

// 运行初始化
initDatabase()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ 初始化脚本执行失败:', err.message);
    console.error('请检查：');
    console.error('  1. MySQL 服务是否启动');
    console.error('  2. .env 文件中的数据库配置是否正确');
    console.error('  3. MySQL 用户权限是否足够');
    process.exit(1);
  });
