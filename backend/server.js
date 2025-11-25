const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const OpenAI = require('openai');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser'); // ✨ 新增
require('dotenv').config();

const app = express();
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const port = 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key'; 
const ROOT_ADMIN_EMAIL = 'admin@test.com'; // 👑 定义超级管理员邮箱

// ✨ 配置 CORS 允许携带 Cookie
app.use(cors({
    origin: 'http://localhost:5173', // 前端地址
    credentials: true // 允许跨域携带 Cookie
}));
app.use(express.json());
app.use(cookieParser()); // ✨ 启用 Cookie 解析

// === 中间件: 验证 Token (从 Cookie 读取) ===
const authenticateToken = (req, res, next) => {
    // ✨ 改动：优先从 Cookie 读取 Token
    const token = req.cookies.token; 
    
    if (!token) return res.status(401).json({ error: '未登录或会话已过期' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Token 无效' });
        req.user = user;
        next();
    });
};

// === 中间件: 验证管理员 ===
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: '权限不足' });
    next();
};

// === ✨ 中间件: 验证超级管理员 (Root Admin) ===
const requireRootAdmin = (req, res, next) => {
    if (req.user.email !== ROOT_ADMIN_EMAIL) {
        return res.status(403).json({ error: '只有超级管理员才有权执行此操作' });
    }
    next();
};

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads';
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

// =======================
// 🔐 Auth API (认证)
// =======================

// 登录
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(400).json({ error: '用户不存在' });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: '密码错误' });

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '2h' });

    // ✨ 改动：将 Token 写入 HttpOnly Cookie (2小时过期)
    res.cookie('token', token, {
        httpOnly: true, // 前端 JS 无法读取，防止 XSS 攻击
        maxAge: 2 * 60 * 60 * 1000, // 2小时 (毫秒)
        sameSite: 'lax' // 防止 CSRF
    });

    // 返回用户信息给前端 (但不返回 Token)
    res.json({ role: user.role, email: user.email });
});

// 登出
app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ message: '已退出' });
});

// 注册 (普通用户)
app.post('/api/auth/register', async (req, res) => {
    const { email, password } = req.body;
    if (!password || password.length < 8) return res.status(400).json({ error: '密码至少8位' });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    try {
        await prisma.user.create({
            data: { email, password: hashedPassword, role: 'user' }
        });
        res.json({ message: '注册成功' });
    } catch (e) {
        res.status(400).json({ error: '邮箱已被注册' });
    }
});

// 检查登录状态 (用于前端刷新页面时恢复状态)
app.get('/api/auth/me', authenticateToken, (req, res) => {
    res.json({ email: req.user.email, role: req.user.role });
});

// =======================
// 🛠️ User API
// =======================

app.get('/api/sessions', authenticateToken, async (req, res) => {
    const sessions = await prisma.document.findMany({
        where: { userId: req.user.id },
        select: { id: true, title: true, createdAt: true },
        orderBy: { createdAt: 'desc' }
    });
    res.json(sessions);
});

app.get('/api/sessions/:id', authenticateToken, async (req, res) => {
    const doc = await prisma.document.findUnique({
        where: { id: req.params.id },
        include: { chats: { orderBy: { createdAt: 'asc' } } }
    });
    if (!doc || (doc.userId !== req.user.id && req.user.role !== 'admin')) {
        return res.status(403).json({ error: '无权访问' });
    }
    res.json({
        id: doc.id,
        title: doc.title,
        summary: doc.summary,
        topics: JSON.parse(doc.topicsJson || '[]'),
        chatHistory: doc.chats
    });
});

app.post('/api/upload', authenticateToken, upload.single('pdf'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: '请上传文件' });
    const title = req.body.title || req.file.originalname;
    const pdfPath = req.file.path;

    const pythonProcess = spawn('./venv/bin/python', ['analyze.py', pdfPath]);
    let dataString = '';
    let errorString = '';
    
    pythonProcess.stdout.on('data', (data) => dataString += data.toString());
    pythonProcess.stderr.on('data', (data) => errorString += data.toString());

    pythonProcess.on('close', async (code) => {
        if (code !== 0) {
            console.error('❌ 分析失败:', errorString);
            return res.status(500).json({ error: '分析失败' });
        }
        try {
            const result = JSON.parse(dataString);
            const newDoc = await prisma.document.create({
                data: {
                    userId: req.user.id,
                    title: title,
                    originalName: req.file.originalname,
                    serverFilename: result.serverFilename,
                    fullText: result.fullText || "",
                    summary: result.summary,
                    topicsJson: JSON.stringify(result.topics)
                }
            });
            res.json({ documentId: newDoc.id, title: newDoc.title, summary: result.summary, topics: result.topics });
        } catch (e) { res.status(500).json({ error: '保存失败' }); }
    });
});

app.post('/api/chat', authenticateToken, async (req, res) => {
    const { documentId, query } = req.body;
    const doc = await prisma.document.findUnique({ where: { id: documentId } });
    if (!doc || doc.userId !== req.user.id) return res.status(403).json({ error: '无权访问' });

    await prisma.chatHistory.create({ data: { documentId, role: 'user', content: query } });
    const recentChats = await prisma.chatHistory.findMany({
        where: { documentId }, orderBy: { createdAt: 'desc' }, take: 6
    });
    const historyContext = recentChats.reverse().map(c => ({ role: c.role === 'user' ? 'user' : 'assistant', content: c.content }));

    const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
            { role: "system", content: "你是一个专业的文档助手。" },
            { role: "user", content: `文档全文:\n${doc.fullText}` },
            ...historyContext,
            { role: "user", content: query }
        ]
    });
    const answer = completion.choices[0].message.content;
    await prisma.chatHistory.create({ data: { documentId, role: 'ai', content: answer } });
    res.json({ answer });
});

app.delete('/api/sessions/:id', authenticateToken, async (req, res) => {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc || doc.userId !== req.user.id) return res.status(403).json({ error: '无权操作' });
    await prisma.document.delete({ where: { id: req.params.id } });
    res.json({ success: true });
});

// =======================
// 👑 Admin API
// =======================

app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    const { search } = req.query;
    const users = await prisma.user.findMany({
        where: search ? { email: { contains: search, mode: 'insensitive' } } : {},
        select: { id: true, email: true, role: true, createdAt: true, _count: { select: { documents: true } } },
        orderBy: { createdAt: 'desc' }
    });
    res.json(users);
});

app.get('/api/admin/users/:userId/docs', authenticateToken, requireAdmin, async (req, res) => {
    const docs = await prisma.document.findMany({
        where: { userId: req.params.userId },
        select: { id: true, title: true, originalName: true, createdAt: true },
        orderBy: { createdAt: 'desc' }
    });
    res.json(docs);
});

// 6. 删除用户 (逻辑升级：保护管理员)
app.delete('/api/admin/users/:userId', authenticateToken, requireAdmin, async (req, res) => {
    try {
        // 1. 先查询目标用户是谁
        const targetUser = await prisma.user.findUnique({ 
            where: { id: req.params.userId } 
        });

        if (!targetUser) return res.status(404).json({ error: '用户不存在' });

        // 2. 核心保护机制
        // 如果目标是管理员，且当前操作者不是超级管理员 (ROOT_ADMIN)，则拒绝
        // (ROOT_ADMIN_EMAIL 在文件头部定义为 'admin@test.com')
        if (targetUser.role === 'admin' && req.user.email !== ROOT_ADMIN_EMAIL) {
            return res.status(403).json({ error: '普通管理员无权删除其他管理员' });
        }

        // 3. 防止自杀 (超级管理员不能删除自己)
        if (targetUser.email === ROOT_ADMIN_EMAIL) {
            return res.status(403).json({ error: '无法删除根管理员账户' });
        }

        // 4. 执行删除
        await prisma.user.delete({ where: { id: req.params.userId } });
        res.json({ success: true });

    } catch (e) {
        console.error("删除用户失败:", e);
        res.status(500).json({ error: "删除操作失败" });
    }
});
// 7. 删除文档

app.delete('/api/admin/documents/:docId', authenticateToken, requireAdmin, async (req, res) => {
    await prisma.document.delete({ where: { id: req.params.docId } });
    res.json({ success: true });
});

// ✨ 注册新管理员 (仅超级管理员可用 requireRootAdmin)
app.post('/api/admin/register-admin', authenticateToken, requireRootAdmin, async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password || password.length < 8) return res.status(400).json({ error: '参数无效' });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    try {
        await prisma.user.create({
            data: { email, password: hashedPassword, role: 'admin' }
        });
        res.json({ message: '管理员账户创建成功' });
    } catch (e) {
        res.status(400).json({ error: '邮箱已被注册' });
    }
});

async function initAdmin() {
    const existingAdmin = await prisma.user.findUnique({ where: { email: ROOT_ADMIN_EMAIL } });
    if (!existingAdmin) {
        const hashedPassword = await bcrypt.hash('!admin123', 10);
        await prisma.user.create({
            data: { email: ROOT_ADMIN_EMAIL, password: hashedPassword, role: 'admin' }
        });
        console.log(`🔒 Root Admin Created: ${ROOT_ADMIN_EMAIL}`);
    }
}

initAdmin().then(() => {
    app.listen(port, () => console.log(`🚀 后端运行在: http://localhost:${port}`));
});