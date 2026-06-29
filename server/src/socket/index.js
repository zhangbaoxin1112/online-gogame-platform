const jwt = require('jsonwebtoken');
const pool = require('../config/database');

// 配置常量
const TURN_TIME_LIMIT = 180; // 每回合时间限制（秒）= 3分钟
const DISCONNECT_TIMEOUT = 30; // 掉线超时时间（秒）= 30秒，给移动端更多重连时间

// 存储在线用户和房间信息
const onlineUsers = new Map(); // socketId -> userId
const userSockets = new Map(); // userId -> socketId
const userClientIds = new Map(); // userId -> clientId（用于区分同设备重连）
const userVisibility = new Map(); // userId -> 'online' | 'away'
const pendingDisconnects = new Map(); // userId -> timeout（延迟断线处理）
const matchingQueues = {
  random: [],   // 随机匹配队列
  normal: [],   // 普通匹配队列（积分相近）
  easy: [],     // 入门匹配队列（找低分玩家）
  hard: []      // 高手匹配队列（找高分玩家）
};
const rooms = new Map(); // roomId -> roomInfo
const turnTimers = new Map(); // roomId -> timer
const friendInvites = new Map(); // inviteId -> invite info

// 向后兼容：保留matchingQueue引用
const matchingQueue = matchingQueues.random;

// 验证Socket连接的token
const authenticateSocket = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    
    if (!token) {
      return next(new Error('未提供认证令牌'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const [users] = await pool.query(
      'SELECT id, username, nickname, avatar, score FROM users WHERE id = ?',
      [decoded.userId]
    );

    if (users.length === 0) {
      return next(new Error('用户不存在'));
    }

    socket.user = users[0];
    next();
  } catch (error) {
    next(new Error('认证失败'));
  }
};

// 生成房间ID
const generateRoomId = () => {
  return `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// 设置Socket处理器
const setupSocketHandlers = (io) => {
  // 使用认证中间件
  io.use(authenticateSocket);

  io.on('connection', async (socket) => {
    const user = socket.user;
    const clientId = socket.handshake.auth.clientId; // 客户端标识符
    console.log(`用户 ${user.nickname} 尝试连接 (Socket: ${socket.id}, ClientId: ${clientId || 'none'})`);

    // 检查是否有待处理的断线（用户快速重连）
    const pendingDisconnect = pendingDisconnects.get(user.id);
    if (pendingDisconnect) {
      clearTimeout(pendingDisconnect);
      pendingDisconnects.delete(user.id);
      console.log(`用户 ${user.nickname} 快速重连，取消断线处理`);
    }

    // 检查用户是否已有其他活跃连接
    const existingSocketId = userSockets.get(user.id);
    const existingClientId = userClientIds.get(user.id);
    
    if (existingSocketId && existingSocketId !== socket.id) {
      const existingSocket = io.sockets.sockets.get(existingSocketId);
      if (existingSocket && existingSocket.connected) {
        // 检查是否是同一客户端的重连（移动端后台恢复等情况）
        if (clientId && existingClientId && clientId === existingClientId) {
          // 同一客户端，允许新连接替换旧连接
          console.log(`用户 ${user.nickname} 同一客户端重连，断开旧连接`);
          existingSocket.disconnect(true);
        } else if (!clientId || !existingClientId) {
          // 没有 clientId，可能是旧版本客户端或重连，允许替换
          console.log(`用户 ${user.nickname} 无ClientId重连，断开旧连接`);
          existingSocket.disconnect(true);
        } else {
          // 不同客户端，真正的多设备登录，拒绝新连接
          console.log(`用户 ${user.nickname} 已在其他设备登录，拒绝新连接`);
          socket.emit('login_error', { message: '该账号已在其他设备登录，请先退出后再登录' });
          socket.disconnect(true);
          return;
        }
      }
      // 清理旧连接的残留数据
      onlineUsers.delete(existingSocketId);
      userSockets.delete(user.id);
    }

    console.log(`用户 ${user.nickname} 连接成功 (Socket: ${socket.id})`);

    // 记录在线状态
    onlineUsers.set(socket.id, user.id);
    userSockets.set(user.id, socket.id);
    if (clientId) {
      userClientIds.set(user.id, clientId);
    }
    userVisibility.set(user.id, 'online');

    // 处理可见性
    socket.on('client_visible', () => {
      console.log(`用户 ${user.nickname} 页面恢复前台`);
      userVisibility.set(user.id, 'online');
    });

    socket.on('client_hidden', () => {
      console.log(`用户 ${user.nickname} 页面切入后台`);
      userVisibility.set(user.id, 'away');
    });

    socket.on('page_close', () => {
      console.log(`用户 ${user.nickname} 页面主动关闭/卸载`);
      userVisibility.set(user.id, 'offline');
    });

    // 更新用户在线状态到数据库
    pool.query('UPDATE users SET status = ? WHERE id = ?', ['online', user.id])
      .catch(err => console.error('更新用户在线状态失败:', err));

    // 向当前用户发送在线人数
    socket.emit('online_count', onlineUsers.size);
    
    // 广播在线人数给所有用户
    io.emit('online_count', onlineUsers.size);

    // ==================== PVE 状态管理 ====================

    // 设置PVE状态（玩家开始人机对弈）
    socket.on('pve_start', async () => {
      try {
        await pool.query('UPDATE users SET status = ? WHERE id = ?', ['playing', user.id]);
        console.log(`用户 ${user.nickname} 开始人机对弈`);
      } catch (error) {
        console.error('设置PVE状态失败:', error);
      }
    });

    // 结束PVE状态（玩家结束人机对弈）
    socket.on('pve_end', async () => {
      try {
        await pool.query('UPDATE users SET status = ? WHERE id = ?', ['online', user.id]);
        console.log(`用户 ${user.nickname} 结束人机对弈`);
      } catch (error) {
        console.error('恢复用户状态失败:', error);
      }
    });

    // ==================== 匹配系统 ====================

    // 获取当前在线人数
    socket.on('get_online_count', () => {
      socket.emit('online_count', onlineUsers.size);
    });

    // 开始匹配
    socket.on('start_matching', async (data) => {
      const { boardSize = 19, matchMode = 'random' } = data;
      
      console.log(`用户 ${user.nickname} 请求匹配, 模式: ${matchMode}, 棋盘: ${boardSize}x${boardSize}, 积分: ${user.score}`);
      
      // 获取对应的匹配队列
      const queue = matchingQueues[matchMode] || matchingQueues.random;
      
      // 检查是否已在任何匹配队列
      for (const q of Object.values(matchingQueues)) {
        const existingIndex = q.findIndex(p => p.id === user.id);
        if (existingIndex !== -1) {
          socket.emit('matching_error', { message: '您已在匹配队列中' });
          return;
        }
      }

      // 检查是否已在进行中的游戏中
      for (const [roomId, room] of rooms) {
        if (room.status === 'playing') {
          const player = room.players.find(p => p.id === user.id);
          if (player) {
            // 增加时间防御检查：如果该玩家已断线超过30秒，则不应提示恢复，且立即执行结算
            if (player.disconnectTime && (Date.now() - player.disconnectTime >= DISCONNECT_TIMEOUT * 1000)) {
              console.log(`用户 ${user.nickname} 请求活跃对局查询，发现已超时 ${DISCONNECT_TIMEOUT}s，执行补位结算`);
              const winner = room.players.find(p => p.id !== user.id);
              if (winner) {
                await endGame(io, room, winner.id, `${user.nickname} 断线超时(补位结算)`);
              }
              continue; // 继续检查下一个房间
            }
            socket.emit('matching_error', { message: '您已在游戏中' });
            return;
          }
        }
      }

      // 清理匹配队列中已离线的用户
      for (let i = queue.length - 1; i >= 0; i--) {
        const player = queue[i];
        const playerSocketId = userSockets.get(player.id);
        const playerSocket = playerSocketId ? io.sockets.sockets.get(playerSocketId) : null;
        if (!playerSocket || !playerSocket.connected) {
          console.log(`清理离线玩家 ${player.nickname} 从匹配队列`);
          queue.splice(i, 1);
        }
      }

      // 根据匹配模式寻找对手
      // 逻辑说明：
      // - random: 在所有队列中找任意对手（核心队列）
      // - normal: 在random和normal队列中找积分相近(±100)的对手
      // - easy: 在random和hard队列中找积分比自己低的对手（hard队列的高分玩家想找低分对手）
      // - hard: 在random和easy队列中找积分比自己高的对手（easy队列的低分玩家想找高分对手）
      let matchIndex = -1;
      let targetQueue = null;
      
      if (matchMode === 'random') {
        // 随机匹配：优先在random队列找，然后遍历所有队列
        const allQueues = [matchingQueues.random, matchingQueues.normal, matchingQueues.easy, matchingQueues.hard];
        for (const q of allQueues) {
          matchIndex = q.findIndex(p => p.boardSize === boardSize && p.id !== user.id);
          if (matchIndex !== -1) {
            targetQueue = q;
            break;
          }
        }
      } else if (matchMode === 'normal') {
        // 普通匹配：在random和normal队列中找积分相近的对手（±100分）
        const searchQueues = [matchingQueues.random, matchingQueues.normal];
        for (const q of searchQueues) {
          matchIndex = q.findIndex(p => 
            p.boardSize === boardSize && 
            p.id !== user.id && 
            Math.abs(p.score - user.score) <= 100
          );
          if (matchIndex !== -1) {
            targetQueue = q;
            break;
          }
        }
      } else if (matchMode === 'easy') {
        // 入门匹配：在random和hard队列中找积分比自己低的对手
        // hard队列中是想找高分对手的玩家，如果他们分数比当前用户低，正好匹配
        const searchQueues = [matchingQueues.random, matchingQueues.hard];
        for (const q of searchQueues) {
          matchIndex = q.findIndex(p => 
            p.boardSize === boardSize && 
            p.id !== user.id && 
            p.score < user.score
          );
          if (matchIndex !== -1) {
            targetQueue = q;
            break;
          }
        }
      } else if (matchMode === 'hard') {
        // 高手匹配：在random和easy队列中找积分比自己高的对手
        // easy队列中是想找低分对手的玩家，如果他们分数比当前用户高，正好匹配
        const searchQueues = [matchingQueues.random, matchingQueues.easy];
        for (const q of searchQueues) {
          matchIndex = q.findIndex(p => 
            p.boardSize === boardSize && 
            p.id !== user.id && 
            p.score > user.score
          );
          if (matchIndex !== -1) {
            targetQueue = q;
            break;
          }
        }
      }
      
      if (matchIndex !== -1 && targetQueue) {
        // 找到匹配的对手
        const opponent = targetQueue.splice(matchIndex, 1)[0];
        const opponentSocketId = userSockets.get(opponent.id);
        const opponentSocket = opponentSocketId ? io.sockets.sockets.get(opponentSocketId) : null;

        if (!opponentSocket || !opponentSocket.connected) {
          // 对手已离线，将当前用户加入队列
          console.log(`对手 ${opponent.nickname} 已离线，将 ${user.nickname} 加入队列`);
          queue.push({ 
            id: user.id, 
            nickname: user.nickname,
            score: user.score,
            boardSize,
            matchMode,
            socketId: socket.id 
          });
          socket.emit('matching_started', { position: queue.length });
          return;
        }

        console.log(`匹配成功！${user.nickname}(${user.score}分) vs ${opponent.nickname}(${opponent.score}分), 模式: ${matchMode}`);

        // 创建房间
        const roomId = generateRoomId();
        
        // 随机决定黑白方
        const isCurrentUserBlack = Math.random() < 0.5;
        const blackPlayer = isCurrentUserBlack ? user : opponent;
        const whitePlayer = isCurrentUserBlack ? opponent : user;

        // 创建对局记录（包含匹配模式）
        const [result] = await pool.query(
          `INSERT INTO games (black_player_id, white_player_id, game_type, match_mode, board_size, moves_record, status)
           VALUES (?, ?, 'pvp', ?, ?, '[]', 'playing')`,
          [blackPlayer.id, whitePlayer.id, matchMode, boardSize]
        );

        const room = {
          id: roomId,
          gameId: result.insertId,
          boardSize,
          matchMode,
          players: [
            { ...blackPlayer, color: 'black', socketId: userSockets.get(blackPlayer.id) },
            { ...whitePlayer, color: 'white', socketId: userSockets.get(whitePlayer.id) }
          ],
          currentTurn: 'black',
          moves: [],
          board: createEmptyBoard(boardSize),
          startTime: Date.now(),
          status: 'playing'
        };

        rooms.set(roomId, room);

        // 让两个玩家加入房间
        socket.join(roomId);
        opponentSocket.join(roomId);

        // 更新玩家状态
        await pool.query('UPDATE users SET status = ? WHERE id IN (?, ?)', 
          ['playing', user.id, opponent.id]);

        // 通知两个玩家匹配成功
        io.to(roomId).emit('match_found', {
          roomId,
          gameId: result.insertId,
          boardSize,
          blackPlayer: { id: blackPlayer.id, nickname: blackPlayer.nickname, avatar: blackPlayer.avatar, score: blackPlayer.score },
          whitePlayer: { id: whitePlayer.id, nickname: whitePlayer.nickname, avatar: whitePlayer.avatar, score: whitePlayer.score },
          yourColor: isCurrentUserBlack ? 'black' : 'white',
          turnTimeLimit: TURN_TIME_LIMIT
        });

        // 单独通知各自的颜色
        socket.emit('your_color', { color: isCurrentUserBlack ? 'black' : 'white' });
        opponentSocket.emit('your_color', { color: isCurrentUserBlack ? 'white' : 'black' });

        // 启动黑方的回合计时器
        startTurnTimer(io, roomId);

        console.log(`匹配成功: ${blackPlayer.nickname}(黑) vs ${whitePlayer.nickname}(白), 房间: ${roomId}, 模式: ${matchMode}`);
      } else {
        // 没有匹配的对手，加入对应模式的队列
        queue.push({ 
          id: user.id, 
          nickname: user.nickname,
          score: user.score,
          boardSize,
          matchMode,
          socketId: socket.id 
        });
        socket.emit('matching_started', { position: queue.length });
        console.log(`用户 ${user.nickname} 开始匹配, 模式: ${matchMode}, 队列长度: ${queue.length}`);
      }
    });

    // 取消匹配
    socket.on('cancel_matching', () => {
      // 从所有队列中移除用户
      for (const queueName of Object.keys(matchingQueues)) {
        const q = matchingQueues[queueName];
        const index = q.findIndex(p => p.id === user.id);
        if (index !== -1) {
          q.splice(index, 1);
          socket.emit('matching_cancelled');
          console.log(`用户 ${user.nickname} 取消匹配 (模式: ${queueName})`);
          return;
        }
      }
    });

    // ==================== 好友邀请系统 ====================

    // 邀请好友
    socket.on('invite_friend', async (data) => {
      const { friendId, boardSize = 19 } = data;
      
      // 检查邀请方分数是否>=100
      if (user.score < 100) {
        socket.emit('matching_error', { message: '您的积分不足100，无法发起好友对战邀请' });
        return;
      }
      
      // 检查好友是否在线
      const friendSocketId = userSockets.get(friendId);
      const friendSocket = friendSocketId ? io.sockets.sockets.get(friendSocketId) : null;
      
      if (!friendSocket || !friendSocket.connected) {
        socket.emit('matching_error', { message: '好友不在线' });
        return;
      }

      // 获取好友信息
      const [friends] = await pool.query(
        'SELECT id, nickname, score FROM users WHERE id = ?',
        [friendId]
      );

      if (friends.length === 0) {
        socket.emit('matching_error', { message: '好友不存在' });
        return;
      }

      const friend = friends[0];
      
      // 检查被邀请方分数是否>=100
      if (friend.score < 100) {
        socket.emit('matching_error', { message: '对方积分不足100，无法进行好友对战' });
        return;
      }

      // 创建邀请
      const inviteId = `invite_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      friendInvites.set(inviteId, {
        id: inviteId,
        from: user,
        to: friend,
        boardSize,
        createdAt: Date.now()
      });

      // 通知好友
      friendSocket.emit('friend_invite', {
        inviteId,
        fromId: user.id,
        fromName: user.nickname,
        fromScore: user.score,
        boardSize
      });

      socket.emit('matching_started', { position: 1, inviteCode: inviteId });
      console.log(`${user.nickname} 邀请 ${friend.nickname} 进行对战`);

      // 30秒后自动过期
      setTimeout(() => {
        if (friendInvites.has(inviteId)) {
          friendInvites.delete(inviteId);
          socket.emit('matching_error', { message: '好友未响应邀请' });
        }
      }, 30000);
    });

    // 接受好友邀请
    socket.on('accept_invite', async (data) => {
      const { inviteId } = data;
      const invite = friendInvites.get(inviteId);

      if (!invite) {
        socket.emit('matching_error', { message: '邀请已过期' });
        return;
      }

      friendInvites.delete(inviteId);

      const fromSocketId = userSockets.get(invite.from.id);
      const fromSocket = fromSocketId ? io.sockets.sockets.get(fromSocketId) : null;

      if (!fromSocket || !fromSocket.connected) {
        socket.emit('matching_error', { message: '对方已离线' });
        return;
      }

      // 创建房间
      const roomId = generateRoomId();
      const isInviterBlack = Math.random() < 0.5;
      const blackPlayer = isInviterBlack ? invite.from : invite.to;
      const whitePlayer = isInviterBlack ? invite.to : invite.from;

      // 创建对局记录
      const [result] = await pool.query(
        `INSERT INTO games (black_player_id, white_player_id, game_type, match_mode, board_size, moves_record, status)
         VALUES (?, ?, 'pvp', 'friend', ?, '[]', 'playing')`,
        [blackPlayer.id, whitePlayer.id, invite.boardSize]
      );

      const room = {
        id: roomId,
        gameId: result.insertId,
        boardSize: invite.boardSize,
        matchMode: 'friend',
        players: [
          { ...blackPlayer, color: 'black', socketId: userSockets.get(blackPlayer.id) },
          { ...whitePlayer, color: 'white', socketId: userSockets.get(whitePlayer.id) }
        ],
        currentTurn: 'black',
        moves: [],
        board: createEmptyBoard(invite.boardSize),
        startTime: Date.now(),
        status: 'playing'
      };

      rooms.set(roomId, room);

      socket.join(roomId);
      fromSocket.join(roomId);

      await pool.query('UPDATE users SET status = ? WHERE id IN (?, ?)', 
        ['playing', invite.from.id, invite.to.id]);

      io.to(roomId).emit('match_found', {
        roomId,
        gameId: result.insertId,
        boardSize: invite.boardSize,
        blackPlayer: { id: blackPlayer.id, nickname: blackPlayer.nickname, avatar: blackPlayer.avatar, score: blackPlayer.score },
        whitePlayer: { id: whitePlayer.id, nickname: whitePlayer.nickname, avatar: whitePlayer.avatar, score: whitePlayer.score },
        matchMode: 'friend',
        turnTimeLimit: TURN_TIME_LIMIT
      });

      socket.emit('your_color', { color: isInviterBlack ? 'white' : 'black' });
      fromSocket.emit('your_color', { color: isInviterBlack ? 'black' : 'white' });

      startTurnTimer(io, roomId);

      console.log(`好友对战: ${blackPlayer.nickname}(黑) vs ${whitePlayer.nickname}(白), 房间: ${roomId}`);
    });

    // 拒绝好友邀请
    socket.on('reject_invite', (data) => {
      const { inviteId } = data;
      const invite = friendInvites.get(inviteId);

      if (!invite) return;

      friendInvites.delete(inviteId);

      const fromSocketId = userSockets.get(invite.from.id);
      const fromSocket = fromSocketId ? io.sockets.sockets.get(fromSocketId) : null;

      if (fromSocket && fromSocket.connected) {
        fromSocket.emit('invite_rejected', { 
          friendId: invite.to.id,
          friendName: invite.to.nickname 
        });
      }

      console.log(`${invite.to.nickname} 拒绝了 ${invite.from.nickname} 的对战邀请`);
    });

    // ==================== 游戏逻辑 ====================

    // 落子
    socket.on('place_stone', async (data) => {
      const { roomId, x, y } = data;
      const room = rooms.get(roomId);

      if (!room || room.status !== 'playing') {
        socket.emit('game_error', { message: '房间不存在或对局已结束' });
        return;
      }

      // 找到当前玩家
      const player = room.players.find(p => p.id === user.id);
      if (!player) {
        socket.emit('game_error', { message: '您不在此房间中' });
        return;
      }

      // 检查是否轮到该玩家
      if (player.color !== room.currentTurn) {
        socket.emit('game_error', { message: '还没轮到您' });
        return;
      }

      // 验证落子位置
      if (x < 0 || x >= room.boardSize || y < 0 || y >= room.boardSize) {
        socket.emit('game_error', { message: '无效的落子位置' });
        return;
      }

      if (room.board[y][x] !== null) {
        socket.emit('game_error', { message: '此位置已有棋子' });
        return;
      }

      // 记录落子
      const move = { x, y, color: player.color, timestamp: Date.now() };
      room.moves.push(move);
      room.board[y][x] = player.color;

      // 处理提子逻辑
      const captured = captureStones(room.board, x, y, player.color);
      
      // 记录提子信息
      if (captured.length > 0) {
        move.captured = captured;
      }

      // 切换回合
      room.currentTurn = room.currentTurn === 'black' ? 'white' : 'black';

      // 同步棋谱到数据库（用于断线重连恢复）
      try {
        await pool.query(
          'UPDATE games SET moves_record = ? WHERE id = ?',
          [JSON.stringify(room.moves), room.gameId]
        );
      } catch (err) {
        console.error('同步棋谱到数据库失败:', err);
      }

      // 重置回合计时器
      startTurnTimer(io, roomId);

      // 广播落子信息
      io.to(roomId).emit('stone_placed', {
        x, y,
        color: player.color,
        captured,
        nextTurn: room.currentTurn,
        moveNumber: room.moves.length,
        turnTimeLimit: TURN_TIME_LIMIT
      });

      console.log(`房间 ${roomId}: ${player.nickname} 落子 (${x}, ${y})`);
    });

    // 认输
    socket.on('resign', async (data) => {
      const { roomId } = data;
      const room = rooms.get(roomId);

      if (!room || room.status !== 'playing') {
        socket.emit('game_error', { message: '房间不存在或对局已结束' });
        return;
      }

      const player = room.players.find(p => p.id === user.id);
      if (!player) return;

      const winner = room.players.find(p => p.id !== user.id);
      
      await endGame(io, room, winner.id, `${player.nickname} 认输`);
    });

    // 请求和棋
    socket.on('request_draw', (data) => {
      const { roomId } = data;
      const room = rooms.get(roomId);

      if (!room || room.status !== 'playing') {
        socket.emit('game_error', { message: '房间不存在或对局已结束' });
        return;
      }

      const opponent = room.players.find(p => p.id !== user.id);
      if (!opponent) return;

      const opponentSocket = io.sockets.sockets.get(opponent.socketId);
      if (opponentSocket) {
        opponentSocket.emit('draw_requested', { 
          from: { id: user.id, nickname: user.nickname }
        });
      }
    });

    // 接受和棋
    socket.on('accept_draw', async (data) => {
      const { roomId } = data;
      const room = rooms.get(roomId);

      if (!room || room.status !== 'playing') {
        socket.emit('game_error', { message: '房间不存在或对局已结束' });
        return;
      }

      await endGame(io, room, null, '双方和棋');
    });

    // 拒绝和棋
    socket.on('reject_draw', (data) => {
      const { roomId } = data;
      const room = rooms.get(roomId);

      if (!room || room.status !== 'playing') {
        socket.emit('game_error', { message: '房间不存在或对局已结束' });
        return;
      }

      const opponent = room.players.find(p => p.id !== user.id);
      if (!opponent) return;

      const opponentSocket = io.sockets.sockets.get(opponent.socketId);
      if (opponentSocket) {
        opponentSocket.emit('draw_rejected');
      }
    });

    // 跳过回合（PASS）
    socket.on('pass', async (data) => {
      const { roomId } = data;
      const room = rooms.get(roomId);

      if (!room || room.status !== 'playing') {
        socket.emit('game_error', { message: '房间不存在或对局已结束' });
        return;
      }

      const player = room.players.find(p => p.id === user.id);
      if (!player || player.color !== room.currentTurn) return;

      // 记录PASS
      const move = { pass: true, color: player.color, timestamp: Date.now() };
      room.moves.push(move);

      // 检查是否双方都PASS（游戏结束）
      if (room.moves.length >= 2) {
        const lastTwo = room.moves.slice(-2);
        if (lastTwo[0].pass && lastTwo[1].pass) {
          // 停止计时器
          clearTurnTimer(roomId);
          // 双方都PASS，计算胜负
          const result = calculateWinner(room.board, room.boardSize);
          await endGame(io, room, result.winnerId, result.description);
          return;
        }
      }

      // 切换回合
      room.currentTurn = room.currentTurn === 'black' ? 'white' : 'black';

      // 重置回合计时器
      startTurnTimer(io, roomId);

      io.to(roomId).emit('player_passed', {
        color: player.color,
        nextTurn: room.currentTurn,
        turnTimeLimit: TURN_TIME_LIMIT
      });
    });

    // ==================== 聊天功能 ====================

    socket.on('chat_message', (data) => {
      const { roomId, message } = data;
      
      if (!roomId || !message) return;

      io.to(roomId).emit('chat_message', {
        from: { id: user.id, nickname: user.nickname, avatar: user.avatar },
        message: message.substring(0, 200), // 限制消息长度
        timestamp: Date.now()
      });
    });

    // ==================== 断线处理 ====================

    socket.on('disconnect', async () => {
      console.log(`用户 ${user.nickname} 已断开连接 (Socket: ${socket.id})`);

      // 检查是否是当前用户的socket（可能已经被新连接替换）
      const currentSocketId = userSockets.get(user.id);
      if (currentSocketId && currentSocketId !== socket.id) {
        // 这个socket已经被新连接替换，不需要处理
        console.log(`用户 ${user.nickname} 的旧连接断开，已有新连接，忽略`);
        onlineUsers.delete(socket.id);
        return;
      }

      // 从在线列表移除
      onlineUsers.delete(socket.id);
      userSockets.delete(user.id);

      // 从所有匹配队列立即移除（匹配队列不需要延迟）
      for (const queueName of Object.keys(matchingQueues)) {
        const q = matchingQueues[queueName];
        const queueIndex = q.findIndex(p => p.id === user.id);
        if (queueIndex !== -1) {
          q.splice(queueIndex, 1);
          console.log(`用户 ${user.nickname} 已从 ${queueName} 队列移除`);
        }
      }

      // 处理正在进行的 PVP 游戏 - 设置断线超时
      const visibility = userVisibility.get(user.id) || 'online';
      
      for (const [roomId, room] of rooms) {
        const playerIndex = room.players.findIndex(p => p.id === user.id);
        if (playerIndex !== -1 && room.status === 'playing') {
          // 统一给30s宽限期，同时保持回合计时走动，不分前后台
          const timeoutSeconds = 30;
          
          // 记录此人掉线时间
          room.players[playerIndex].disconnectTime = Date.now();
          
          // 检查对方是否也已经断线
          const otherPlayer = room.players.find(p => p.id !== user.id);
          if (otherPlayer.disconnectTime) {
              // 双方都断线，判定先断线的人输
              const winnerId = otherPlayer.disconnectTime < room.players[playerIndex].disconnectTime ? user.id : otherPlayer.id;
              const loserName = winnerId === user.id ? otherPlayer.nickname : user.nickname;
              console.log(`双方均离线，判定先掉线的 ${loserName} 输`);
              // 异步防阻塞
              endGame(io, room, winnerId, `${loserName} 率先掉线，判定对方胜利`).catch(console.error);
              continue;
          }
          
          room.disconnectedPlayer = user.id;
          
          // 如果已有定时器，先清除以防止多次刷新导致的时间漂移
          if (room.disconnectTimeout) {
            clearTimeout(room.disconnectTimeout);
          }

          room.disconnectTimeout = setTimeout(async () => {
            if (rooms.has(roomId) && room.status === 'playing') {
              const winner = room.players.find(p => p.id !== user.id);
              console.log(`用户 ${user.nickname} 断线超时，判定 ${winner.nickname} 胜利`);
              await endGame(io, room, winner.id, `${user.nickname} 网络断开超时，判定对方胜利`);
            }
          }, timeoutSeconds * 1000);

          // 通知对手
          io.to(roomId).emit('opponent_disconnected', {
            playerId: user.id,
            playerName: user.nickname,
            timeout: timeoutSeconds,
            message: `对手网络已断开，若 ${timeoutSeconds} 秒后未连回将判定您获胜`
          });
          
          console.log(`用户 ${user.nickname} 在游戏中断线，等待 ${timeoutSeconds} 秒重连`);
        }
      }

      // 延迟更新用户状态（给用户快速重连的机会）
      const disconnectDelay = setTimeout(async () => {
        pendingDisconnects.delete(user.id);
        // 再次检查用户是否已重连
        if (!userSockets.has(user.id)) {
          await pool.query('UPDATE users SET status = ? WHERE id = ?', ['offline', user.id]);
          console.log(`用户 ${user.nickname} 断线后未重连，标记为离线`);
        }
      }, 5000); // 5秒延迟
      
      pendingDisconnects.set(user.id, disconnectDelay);

      // 广播在线人数
      io.emit('online_count', onlineUsers.size);
    });
    
    // 检查用户是否有活跃中的对局 (用于首页恢复引导)
    socket.on('check_active_game', () => {
      console.log(`用户 ${user.nickname} 请求检查活跃对局`);
      for (const [roomId, room] of rooms) {
        const player = room.players.find(p => p.id === user.id);
        if (player && room.status === 'playing') {
          // 增加探测时的时间防御检查：如果该玩家已断线超过30秒，则不应提示恢复，且立即执行补位结算
          if (player.disconnectTime && (Date.now() - player.disconnectTime >= 30000)) {
            console.log(`用户 ${user.nickname} 请求活跃对局查询，发现已超时 30s，执行补位结算`);
            const winner = room.players.find(p => p.id !== user.id);
            if (winner) {
              endGame(io, room, winner.id, `${user.nickname} 断线超时(补位探测结算)`).catch(console.error);
            }
            continue; // 继续探测下一个可能存在的房间
          }

          const opponent = room.players.find(p => p.id !== user.id);
          const blackPlayer = room.players.find(p => p.color === 'black');
          const whitePlayer = room.players.find(p => p.color === 'white');
          
          socket.emit('active_game_found', {
            roomId: roomId,
            gameId: room.gameId,
            opponentName: opponent ? opponent.nickname : 'AI',
            mode: room.matchMode || 'random',
            boardSize: room.boardSize || 19,
            blackPlayer: blackPlayer,
            whitePlayer: whitePlayer
          });
          console.log(`为用户 ${user.nickname} 查找到活跃房间: ${roomId}`);
          return; // 找到一个就够了
        }
      }
    });

    // 重新连接 / 恢复对局
    socket.on('reconnect_game', async (data) => {
      const { roomId, gameId } = data;
      let room = rooms.get(roomId);

      // 如果内存中没有房间，尝试从数据库恢复
      if (!room && gameId) {
        try {
          const [games] = await pool.query(
            `SELECT g.*, 
              bp.id as bp_id, bp.nickname as bp_nickname, bp.avatar as bp_avatar, bp.score as bp_score,
              wp.id as wp_id, wp.nickname as wp_nickname, wp.avatar as wp_avatar, wp.score as wp_score
             FROM games g
             LEFT JOIN users bp ON g.black_player_id = bp.id
             LEFT JOIN users wp ON g.white_player_id = wp.id
             WHERE g.id = ? AND g.status = 'playing'`,
            [gameId]
          );

          if (games.length > 0) {
            const game = games[0];
            // 验证用户是否是该对局的参与者
            if (game.black_player_id !== user.id && game.white_player_id !== user.id) {
              socket.emit('reconnect_failed', { message: '您不是该对局的参与者' });
              return;
            }

            // 从数据库恢复棋谱并重建棋盘
            const moves = typeof game.moves_record === 'string' 
              ? JSON.parse(game.moves_record) 
              : (game.moves_record || []);
            
            const board = createEmptyBoard(game.board_size);
            for (const move of moves) {
              if (!move.pass && move.x !== undefined && move.y !== undefined) {
                board[move.y][move.x] = move.color;
                // 处理提子
                if (move.captured) {
                  for (const cap of move.captured) {
                    board[cap.y][cap.x] = null;
                  }
                }
              }
            }

            // 计算当前回合
            let currentTurn = 'black';
            if (moves.length > 0) {
              const lastMove = moves[moves.length - 1];
              currentTurn = lastMove.color === 'black' ? 'white' : 'black';
            }

            // 重建房间
            room = {
              id: roomId,
              gameId: game.id,
              boardSize: game.board_size,
              matchMode: game.match_mode,
              players: [
                { id: game.bp_id, nickname: game.bp_nickname, avatar: game.bp_avatar, score: game.bp_score, color: 'black', socketId: null },
                { id: game.wp_id, nickname: game.wp_nickname, avatar: game.wp_avatar, score: game.wp_score, color: 'white', socketId: null }
              ],
              currentTurn,
              moves,
              board,
              startTime: new Date(game.created_at).getTime(),
              status: 'playing'
            };

            rooms.set(roomId, room);
            console.log(`从数据库恢复对局: ${roomId}, gameId: ${gameId}`);
          }
        } catch (err) {
          console.error('从数据库恢复对局失败:', err);
        }
      }

      if (!room || room.status !== 'playing') {
        console.log(`用户 ${user.nickname} 尝试重连已结束或不存在的房间: ${roomId}`);
        socket.emit('reconnect_failed', { message: '该对局已结束' });
        return;
      }

      const player = room.players.find(p => p.id === user.id);
      if (!player) {
        socket.emit('reconnect_failed', { message: '您不在此对局中' });
        return;
      }

      // 清除断线超时
      if (room.disconnectTimeout && room.disconnectedPlayer === user.id) {
        clearTimeout(room.disconnectTimeout);
        room.disconnectTimeout = null;
        room.disconnectedPlayer = null;
      }
      player.disconnectTime = null;

      // 更新socket信息
      player.socketId = socket.id;
      socket.join(roomId);

      // 发送当前游戏状态
      socket.emit('game_state', {
        roomId,
        gameId: room.gameId,
        board: room.board,
        moves: room.moves,
        currentTurn: room.currentTurn,
        players: room.players.map(p => ({
          id: p.id, nickname: p.nickname, avatar: p.avatar, color: p.color, score: p.score
        })),
        yourColor: player.color,
        turnTimeLimit: TURN_TIME_LIMIT
      });

      // 如果回合计时器没有在运行（如从数据库刚恢复的房间），则启动它
      if (!turnTimers.has(roomId)) {
        startTurnTimer(io, roomId);
      }

      // 通知对手已重连
      io.to(roomId).emit('opponent_reconnected', { playerId: user.id });
      
      console.log(`用户 ${user.nickname} 重连对局成功: ${roomId}`);
    });
  });
};

// ==================== 回合计时器 ====================

// 启动/重置回合计时器
function startTurnTimer(io, roomId) {
  // 清除旧计时器
  clearTurnTimer(roomId);
  
  const room = rooms.get(roomId);
  if (!room || room.status !== 'playing') return;

  // 记录回合开始时间
  room.turnStartTime = Date.now();

  // 每秒广播剩余时间
  const intervalId = setInterval(() => {
    const r = rooms.get(roomId);
    if (!r || r.status !== 'playing') {
      clearInterval(intervalId);
      return;
    }

    const elapsed = Math.floor((Date.now() - r.turnStartTime) / 1000);
    const remaining = TURN_TIME_LIMIT - elapsed;

    // 广播剩余时间
    io.to(roomId).emit('turn_time_update', {
      remaining,
      currentTurn: r.currentTurn
    });

    // 时间到，自动随机落子
    if (remaining <= 0) {
      clearInterval(intervalId);
      autoPlaceStone(io, roomId);
    }
  }, 1000);

  turnTimers.set(roomId, intervalId);
}

// 清除回合计时器
function clearTurnTimer(roomId) {
  const timerId = turnTimers.get(roomId);
  if (timerId) {
    clearInterval(timerId);
    turnTimers.delete(roomId);
  }
}

// 超时自动随机落子
async function autoPlaceStone(io, roomId) {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'playing') return;

  const currentPlayer = room.players.find(p => p.color === room.currentTurn);
  if (!currentPlayer) return;

  // 找到所有空位
  const emptyPositions = [];
  for (let y = 0; y < room.boardSize; y++) {
    for (let x = 0; x < room.boardSize; x++) {
      if (room.board[y][x] === null) {
        // 简单检查：不能自杀
        if (isValidMove(room.board, x, y, room.currentTurn)) {
          emptyPositions.push({ x, y });
        }
      }
    }
  }

  if (emptyPositions.length === 0) {
    // 没有可下的位置，自动PASS
    const move = { pass: true, color: room.currentTurn, timestamp: Date.now(), auto: true };
    room.moves.push(move);

    // 检查双方都PASS
    if (room.moves.length >= 2 && room.moves[room.moves.length - 2].pass) {
      const result = calculateWinner(room.board, room.boardSize);
      await endGame(io, room, result.winnerId, result.description);
      return;
    }

    room.currentTurn = room.currentTurn === 'black' ? 'white' : 'black';
    
    io.to(roomId).emit('auto_pass', {
      color: currentPlayer.color,
      playerName: currentPlayer.nickname,
      nextTurn: room.currentTurn,
      message: `${currentPlayer.nickname} 超时，系统自动PASS`
    });

    startTurnTimer(io, roomId);
    return;
  }

  // 随机选择一个位置
  const randomPos = emptyPositions[Math.floor(Math.random() * emptyPositions.length)];
  
  // 落子
  const move = { x: randomPos.x, y: randomPos.y, color: room.currentTurn, timestamp: Date.now(), auto: true };
  room.moves.push(move);
  room.board[randomPos.y][randomPos.x] = room.currentTurn;

  // 处理提子
  const captured = captureStones(room.board, randomPos.x, randomPos.y, room.currentTurn);

  // 切换回合
  const previousTurn = room.currentTurn;
  room.currentTurn = room.currentTurn === 'black' ? 'white' : 'black';

  // 广播自动落子
  io.to(roomId).emit('auto_stone_placed', {
    x: randomPos.x,
    y: randomPos.y,
    color: previousTurn,
    captured,
    nextTurn: room.currentTurn,
    moveNumber: room.moves.length,
    playerName: currentPlayer.nickname,
    message: `${currentPlayer.nickname} 超时，系统随机落子`,
    turnTimeLimit: TURN_TIME_LIMIT
  });

  console.log(`房间 ${roomId}: ${currentPlayer.nickname} 超时，系统自动落子 (${randomPos.x}, ${randomPos.y})`);

  // 重启计时器
  startTurnTimer(io, roomId);
}

// 检查落子是否有效（简化版）
function isValidMove(board, x, y, color) {
  if (board[y][x] !== null) return false;
  
  const size = board.length;
  const tempBoard = board.map(row => [...row]);
  tempBoard[y][x] = color;
  
  // 检查是否能吃子
  const opponent = color === 'black' ? 'white' : 'black';
  const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  let canCapture = false;
  
  for (const [dx, dy] of directions) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && nx < size && ny >= 0 && ny < size && tempBoard[ny][nx] === opponent) {
      const group = getGroup(tempBoard, nx, ny);
      if (!hasLiberty(tempBoard, group)) {
        canCapture = true;
        for (const pos of group) {
          tempBoard[pos.y][pos.x] = null;
        }
      }
    }
  }
  
  // 检查自杀
  if (!canCapture) {
    const myGroup = getGroup(tempBoard, x, y);
    if (!hasLiberty(tempBoard, myGroup)) {
      return false;
    }
  }
  
  return true;
}

// ==================== 辅助函数 ====================

// 创建空棋盘
function createEmptyBoard(size) {
  return Array(size).fill(null).map(() => Array(size).fill(null));
}

// 提子逻辑
function captureStones(board, x, y, color) {
  const size = board.length;
  const opponentColor = color === 'black' ? 'white' : 'black';
  const captured = [];
  const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]];

  // 检查相邻的对手棋子群是否被吃
  for (const [dx, dy] of directions) {
    const nx = x + dx;
    const ny = y + dy;
    
    if (nx >= 0 && nx < size && ny >= 0 && ny < size && board[ny][nx] === opponentColor) {
      const group = getGroup(board, nx, ny);
      if (!hasLiberty(board, group)) {
        // 提子
        for (const pos of group) {
          board[pos.y][pos.x] = null;
          captured.push(pos);
        }
      }
    }
  }

  return captured;
}

// 获取棋子群
function getGroup(board, x, y) {
  const size = board.length;
  const color = board[y][x];
  const group = [];
  const visited = new Set();
  const stack = [{ x, y }];

  while (stack.length > 0) {
    const pos = stack.pop();
    const key = `${pos.x},${pos.y}`;
    
    if (visited.has(key)) continue;
    visited.add(key);
    
    if (pos.x < 0 || pos.x >= size || pos.y < 0 || pos.y >= size) continue;
    if (board[pos.y][pos.x] !== color) continue;
    
    group.push(pos);
    
    stack.push({ x: pos.x + 1, y: pos.y });
    stack.push({ x: pos.x - 1, y: pos.y });
    stack.push({ x: pos.x, y: pos.y + 1 });
    stack.push({ x: pos.x, y: pos.y - 1 });
  }

  return group;
}

// 检查棋子群是否有气
function hasLiberty(board, group) {
  const size = board.length;
  const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]];

  for (const pos of group) {
    for (const [dx, dy] of directions) {
      const nx = pos.x + dx;
      const ny = pos.y + dy;
      
      if (nx >= 0 && nx < size && ny >= 0 && ny < size && board[ny][nx] === null) {
        return true;
      }
    }
  }

  return false;
}

// 计算胜负（简化版本，使用数子法）
function calculateWinner(board, size) {
  let blackCount = 0;
  let whiteCount = 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (board[y][x] === 'black') {
        blackCount++;
      } else if (board[y][x] === 'white') {
        whiteCount++;
      }
    }
  }

  // 白棋贴目（中国规则贴3.75子 = 7.5目）
  const komi = 7.5;
  const blackFinalScore = blackCount;
  const whiteFinalScore = whiteCount + komi;

  if (blackFinalScore > whiteFinalScore) {
    return {
      winnerId: null, // 需要从房间信息获取
      winnerColor: 'black',
      description: `黑方胜 (${blackFinalScore} vs ${whiteFinalScore})`
    };
  } else {
    return {
      winnerId: null,
      winnerColor: 'white', 
      description: `白方胜 (${whiteFinalScore} vs ${blackFinalScore})`
    };
  }
}

// 结束游戏
async function endGame(io, room, winnerId, result) {
  room.status = 'finished';
  const duration = Math.floor((Date.now() - room.startTime) / 1000);

  // 清除回合计时器
  clearTurnTimer(room.id);

  // 如果winnerId为null但有winnerColor，从房间获取实际winnerId
  if (!winnerId && result.winnerColor) {
    const winner = room.players.find(p => p.color === result.winnerColor);
    if (winner) winnerId = winner.id;
  }

  // 根据匹配模式获取积分规则
  const getScoreDelta = (matchMode, isWinner) => {
    // 积分规则：
    // random: 胜利+20，失败-20
    // normal: 胜利+30，失败-30
    // easy: 胜利+10，失败-10
    // hard: 胜利+50，失败-50
    // friend: 胜利+15，失败-15
    const scoreRules = {
      random: { win: 20, lose: -20 },
      normal: { win: 30, lose: -30 },
      easy: { win: 10, lose: -10 },
      hard: { win: 50, lose: -50 },
      friend: { win: 15, lose: -15 }
    };
    const rule = scoreRules[matchMode] || scoreRules.random;
    return isWinner ? rule.win : rule.lose;
  };

  const matchMode = room.matchMode || 'random';

  try {
    // 更新对局记录
    await pool.query(
      `UPDATE games SET winner_id = ?, moves_record = ?, result = ?, 
       duration = ?, status = 'finished', finished_at = NOW() WHERE id = ?`,
      [winnerId, JSON.stringify(room.moves), result, duration, room.gameId]
    );

    // 更新玩家积分和状态
    const scoreDeltas = {}; // 记录每个玩家的分数变化
    for (const player of room.players) {
      const isWinner = player.id === winnerId;
      const isDraw = winnerId === null;
      
      let scoreDelta = 0;
      if (!isDraw) {
        scoreDelta = getScoreDelta(matchMode, isWinner);
      }
      
      scoreDeltas[player.id] = scoreDelta; // 保存分数变化

      await pool.query(
        `UPDATE users SET status = 'online', score = score + ?, 
         total_games = total_games + 1, win_games = win_games + ? WHERE id = ?`,
        [scoreDelta, isWinner ? 1 : 0, player.id]
      );

      // 记录积分变动
      if (scoreDelta !== 0) {
        const [userResult] = await pool.query('SELECT score FROM users WHERE id = ?', [player.id]);
        const modeNames = { random: '随机', normal: '普通', easy: '入门', hard: '高手', friend: '好友' };
        const modeName = modeNames[matchMode] || '随机';
        await pool.query(
          `INSERT INTO score_logs (user_id, delta, new_score, reason, game_id) VALUES (?, ?, ?, ?, ?)`,
          [player.id, scoreDelta, userResult[0].score, isWinner ? `PVP${modeName}模式胜利` : `PVP${modeName}模式失败`, room.gameId]
        );
      }
    }

    // 通知所有玩家游戏结束
    io.to(room.id).emit('game_ended', {
      winnerId,
      result: typeof result === 'string' ? result : result.description,
      duration,
      moves: room.moves.length,
      gameId: room.gameId,
      scoreDeltas  // 添加各玩家的分数变化
    });

    // 清除断线超时
    if (room.disconnectTimeout) {
      clearTimeout(room.disconnectTimeout);
    }

    // 延迟删除房间（给玩家时间查看结果）
    setTimeout(() => {
      rooms.delete(room.id);
    }, 5000);

  } catch (error) {
    console.error('结束游戏错误:', error);
  }
}

module.exports = setupSocketHandlers;
