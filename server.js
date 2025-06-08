const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs-extra');
const path = require('path');
const cors = require('cors');
const session = require('express-session');
const schedule = require('node-schedule');
const inquirer = require('inquirer');
const os = require('os');

// 导入模块
const BotManager = require('./modules/BotManager');
const ApiRoutes = require('./modules/ApiRoutes');
const LagrangeInstaller = require('./modules/LagrangeInstaller');

class OneBotManagerServer {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = socketIo(this.server, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });
        
        this.config = null;
        this.botManager = null;
        this.apiRoutes = null;
        this.scheduledJobs = new Map();
    }

    // 创建默认配置
    createDefaultConfig() {
        const platform = os.platform();
        const executableName = platform === 'win32' ? 'Lagrange.OneBot.exe' : 'Lagrange.OneBot';
        
        return {
            server: {
                host: "0.0.0.0",
                port: 12345,
                apiKey: "onebot-manager-2024"
            },
            executablePath: `./${executableName}`,
            botRootDir: "./onebot",
            logDir: "./logs",
            maxInstances: 3,
            firstStart: {
                configCompleted: false,
                executableConfigured: false
            },
            bot: {
                checkInterval: 5000,
                qrCodeCheckInterval: 2000,
                maxRestartAttempts: 3,
                restartDelay: 5000,
                autoRestart: true,
                healthCheck: {
                    enabled: true,
                    interval: 30000,
                    timeout: 10000
                }
            },
            autoDownload: {
                enable: true,
                source: "github",
                autoUpdate: false
            },
            scheduler: {
                autoRestartAll: false,
                autoRestartTime: "03:00"
            },
            advanced: {
                enableApiRateLimit: true,
                maxApiRequestsPerMinute: 100,
                enableWebSocketRateLimit: true,
                maxWebSocketEventsPerSecond: 50,
                logLevel: "info",
                maxLogFileSize: "10MB",
                maxLogFiles: 5
            }
        };
    }

    // 路径转换函数 - 将绝对路径转换为相对路径
    toRelativePath(absolutePath) {
        if (!absolutePath) return absolutePath;
        
        try {
            // 获取项目根目录
            const projectRoot = __dirname;
            
            // 如果已经是相对路径，直接返回
            if (!path.isAbsolute(absolutePath)) {
                return absolutePath.replace(/\\/g, '/');
            }
            
            // 计算相对路径
            const relativePath = path.relative(projectRoot, absolutePath);
            
            // 确保使用 ./ 前缀，统一使用正斜杠
            const normalizedPath = relativePath.replace(/\\/g, '/');
            return normalizedPath.startsWith('./') ? normalizedPath : `./${normalizedPath}`;
            
        } catch (error) {
            console.warn('路径转换失败:', error.message);
            return absolutePath;
        }
    }

    // 获取标准化的可执行文件相对路径
    getStandardExecutablePath() {
        const platform = os.platform();
        const executableName = platform === 'win32' ? 'Lagrange.OneBot.exe' : 'Lagrange.OneBot';
        return `./${executableName}`;
    }

    // 验证路径是否存在（支持相对路径和绝对路径）
    async validatePath(inputPath) {
        if (!inputPath) return false;
        
        try {
            // 如果是相对路径，转换为绝对路径进行验证
            const fullPath = path.isAbsolute(inputPath) 
                ? inputPath 
                : path.resolve(__dirname, inputPath);
            
            return await fs.pathExists(fullPath);
        } catch (error) {
            return false;
        }
    }

    // 加载配置文件 - 修复版本，支持自动创建默认配置
    async loadConfig() {
        const configPath = path.join(__dirname, 'config.json');
        
        try {
            // 尝试读取现有配置文件
            this.config = await fs.readJson(configPath);
            console.log('✅ 配置文件加载成功');
            
            // 确保可执行文件路径是相对路径格式
            if (this.config.executablePath) {
                this.config.executablePath = this.toRelativePath(this.config.executablePath);
            }
        } catch (error) {
            console.warn('⚠️  配置文件读取失败:', error.message);
            console.log('🔧 正在创建默认配置文件...');
            
            // 创建默认配置
            this.config = this.createDefaultConfig();
            
            try {
                // 保存默认配置到文件
                await fs.writeJson(configPath, this.config, { spaces: 2 });
                console.log('✅ 默认配置文件已创建: config.json');
                console.log('📝 请根据需要修改配置文件后重启程序');
            } catch (writeError) {
                console.error('❌ 无法创建配置文件:', writeError.message);
                console.log('⚡ 使用内存中的默认配置继续运行...');
            }
        }
    }

    // 检查并自动下载Lagrange
    async checkAndDownloadLagrange() {
        if (!this.config.firstStart.executableConfigured) {
            console.log('\n=== Lagrange.OneBot 可执行文件配置 ===');
            
            // 检查是否已安装
            const isInstalled = LagrangeInstaller.checkLagrangeInstalled();
            
            if (!isInstalled && this.config.autoDownload && this.config.autoDownload.enable) {
                const questions = [
                    {
                        type: 'confirm',
                        name: 'autoDownload',
                        message: '未检测到 Lagrange.OneBot 可执行文件，是否自动下载？',
                        default: true
                    }
                ];

                const answers = await inquirer.prompt(questions);
                
                if (answers.autoDownload) {
                    console.log('\n正在自动下载 Lagrange.OneBot...');
                    try {
                        await LagrangeInstaller.downloadLagrange(false);
                        
                        // 使用标准化的相对路径
                        this.config.executablePath = this.getStandardExecutablePath();
                        this.config.firstStart.executableConfigured = true;
                        
                        console.log(`Lagrange.OneBot 下载完成: ${this.config.executablePath}`);
                    } catch (error) {
                        console.error('自动下载失败:', error.message);
                        
                        // 询问手动路径
                        const pathQuestions = [
                            {
                                type: 'input',
                                name: 'executablePath',
                                message: '请输入 Lagrange.OneBot 可执行文件路径 (支持相对路径如 ./Lagrange.OneBot.exe):',
                                default: this.config.executablePath,
                                validate: async (input) => {
                                    if (await this.validatePath(input)) {
                                        return true;
                                    }
                                    return '文件不存在，请输入正确的路径';
                                }
                            }
                        ];
                        
                        const pathAnswers = await inquirer.prompt(pathQuestions);
                        // 转换为相对路径
                        this.config.executablePath = this.toRelativePath(pathAnswers.executablePath);
                        this.config.firstStart.executableConfigured = true;
                    }
                } else {
                    // 询问手动路径
                    const pathQuestions = [
                        {
                            type: 'input',
                            name: 'executablePath',
                            message: '请输入 Lagrange.OneBot 可执行文件路径 (支持相对路径如 ./Lagrange.OneBot.exe):',
                            default: this.config.executablePath,
                            validate: async (input) => {
                                if (await this.validatePath(input)) {
                                    return true;
                                }
                                return '文件不存在，请输入正确的路径';
                            }
                        }
                    ];
                    
                    const pathAnswers = await inquirer.prompt(pathQuestions);
                    // 转换为相对路径
                    this.config.executablePath = this.toRelativePath(pathAnswers.executablePath);
                    this.config.firstStart.executableConfigured = true;
                }
                
                // 保存配置
                await fs.writeJson(path.join(__dirname, 'config.json'), this.config, { spaces: 2 });
            } else if (!isInstalled) {
                // 询问手动路径
                const pathQuestions = [
                    {
                        type: 'input',
                        name: 'executablePath',
                        message: '请输入 Lagrange.OneBot 可执行文件路径 (支持相对路径如 ./Lagrange.OneBot.exe):',
                        default: this.config.executablePath,
                        validate: async (input) => {
                            if (await this.validatePath(input)) {
                                return true;
                            }
                            return '文件不存在，请输入正确的路径';
                        }
                    }
                ];
                
                const pathAnswers = await inquirer.prompt(pathQuestions);
                // 转换为相对路径
                this.config.executablePath = this.toRelativePath(pathAnswers.executablePath);
                this.config.firstStart.executableConfigured = true;
                
                // 保存配置
                await fs.writeJson(path.join(__dirname, 'config.json'), this.config, { spaces: 2 });
            } else {
                // 已安装，使用标准化的相对路径
                this.config.executablePath = this.getStandardExecutablePath();
                this.config.firstStart.executableConfigured = true;
                
                console.log(`检测到已安装的 Lagrange.OneBot: ${this.config.executablePath}`);
                
                // 保存配置
                await fs.writeJson(path.join(__dirname, 'config.json'), this.config, { spaces: 2 });
            }
        }
    }

    // 首次启动配置询问 - 简化版本
    async firstTimeSetup() {
        if (this.config.firstStart && !this.config.firstStart.configCompleted) {
            console.log('\n=== OneBot 管理器首次启动配置 ===');
            
            const questions = [
                {
                    type: 'number',
                    name: 'port',
                    message: '服务器端口:',
                    default: this.config.server.port,
                    validate: (input) => {
                        if (input >= 1024 && input <= 65535) {
                            return true;
                        }
                        return '端口必须在 1024-65535 之间';
                    }
                },
                {
                    type: 'password',
                    name: 'apiKey',
                    message: 'API Key (用于WebUI登录):',
                    default: this.config.server.apiKey,
                    mask: '*'
                }
            ];

            const answers = await inquirer.prompt(questions);
            
            // 更新配置
            this.config.server.port = answers.port;
            this.config.server.apiKey = answers.apiKey;
            this.config.firstStart.configCompleted = true;

            // 保存配置到文件
            await fs.writeJson(path.join(__dirname, 'config.json'), this.config, { spaces: 2 });
            
            console.log('\n配置已保存，启动服务器...\n');
        }
    }

    // 获取客户端IP地址
    getClientAddress(req) {
        const forwarded = req.headers['x-forwarded-for'];
        const realIp = req.headers['x-real-ip'];
        const remoteAddress = req.connection.remoteAddress || 
                             req.socket.remoteAddress ||
                             (req.connection.socket ? req.connection.socket.remoteAddress : null);
        
        if (forwarded) {
            return forwarded.split(',')[0].trim();
        }
        if (realIp) {
            return realIp;
        }
        if (remoteAddress) {
            return remoteAddress.replace('::ffff:', '');
        }
        return '127.0.0.1';
    }

    // 动态获取服务器地址
    getServerAddress(req) {
        const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
        const wsProtocol = protocol === 'https' ? 'wss' : 'ws';
        const host = req.headers.host || `${this.config.server.host}:${this.config.server.port}`;
        const hostname = req.hostname || req.headers['x-forwarded-host'] || this.config.server.host;
        const port = req.headers['x-forwarded-port'] || this.config.server.port;
        
        return {
            protocol,
            wsProtocol,
            hostname: hostname === '0.0.0.0' ? '127.0.0.1' : hostname,
            port,
            fullHost: host,
            baseUrl: `${protocol}://${host}`,
            wsBaseUrl: `${wsProtocol}://${host}`
        };
    }

    // 初始化应用
    async initialize() {
        await this.loadConfig();
        await this.checkAndDownloadLagrange();
        await this.firstTimeSetup();

        // 从配置文件获取设置
        const PORT = process.env.PORT || this.config.server.port;
        const HOST = process.env.HOST || this.config.server.host;
        const API_KEY = process.env.API_KEY || this.config.server.apiKey;

        // 显示启动横幅
        console.log('\n');
        console.log('                                                     __                                          ');
        console.log('                                                    / /   ____ _____ __________ _____  ____ ____ ');
        console.log('                                                   / /   / __ `/ __ `/ ___/ __ `/ __ \\/ __ `/ _ \\');
        console.log('                                                  / /___/ /_/ / /_/ / /  / /_/ / / / / /_/ /  __/');
        console.log('                                                 /_____/\\__,_/\\__, /_/   \\__,_/_/ /_/\\__, /\\___/ ');
        console.log('                                                             /____/                 /____/       ');
        console.log('                                                       ____             __          __           ');
        console.log('                                                      / __ \\____  ___  / /_  ____  / /_          ');
        console.log('                                                     / / / / __ \\/ _ \\/ __ \\/ __ \\/ __/          ');
        console.log('                                                    / /_/ / / / /  __/ /_/ / /_/ / /_            ');
        console.log('                                                    \\____/_/ /_/\\___/_.___/\\____/\\__/            ');
        console.log('                                                                                                 ');
        console.log('                                                         _       __     __          _            ');
        console.log('                                                        | |     / /__  / /_  __  __(_)           ');
        console.log('                                                        | | /| / / _ \\/ __ \\/ / / / /            ');
        console.log('                                                        | |/ |/ /  __/ /_/ / /_/ / /             ');
        console.log('                                                        |__/|__/\\___/_.___/\\__,_/_/              ');
        console.log('                                                                                                 ');
        console.log('                                             ____           __  ___      _                 _     ');
        console.log('                                            / __ )__  __   /  |/  /___ _(_)___ ___  ____ _(_)    ');
        console.log('                                           / __  / / / /  / /|_/ / __ `/ / __ `__ \\/ __ `/ /     ');
        console.log('                                          / /_/ / /_/ /  / /  / / /_/ / / / / / / / /_/ / /      ');
        console.log('                                         /_____/\\__, /  /_/  /_/\\__,_/_/_/ /_/ /_/\\__,_/_/       ');
        console.log('                                               /____/                                         ');
        
        console.log('====================================');
        console.log(' OneBot 机器人管理器 v2.0.0');
        console.log(' 配置文件修复版 - 支持自动创建默认配置');
        console.log('====================================');
        console.log(`配置加载成功:`);
        console.log(`- 机器人目录: ${this.config.botRootDir}`);
        console.log(`- 日志目录: ${this.config.logDir}`);
        console.log(`- 可执行文件: ${this.config.executablePath}`);
        console.log(`- 服务器端口: ${PORT}`);
        console.log(`- API Key: ${API_KEY}`);
        console.log(`- 检测间隔: ${this.config.bot.checkInterval}ms`);
        console.log(`- 二维码检测间隔: ${this.config.bot.qrCodeCheckInterval}ms`);
        console.log(`- 自动重启时间: ${this.config.scheduler.autoRestartTime}`);

        // 验证可执行文件路径
        const executableExists = await this.validatePath(this.config.executablePath);
        if (!executableExists) {
            console.warn(`⚠️  警告: 可执行文件不存在: ${this.config.executablePath}`);
            console.warn(`请确保文件存在或重新配置路径`);
        } else {
            console.log(`✅ 可执行文件验证成功: ${this.config.executablePath}`);
        }

        // 确保日志目录存在
        await fs.ensureDir(this.config.logDir);

        // 初始化管理器
        this.botManager = new BotManager(this.config, this.io);
        this.apiRoutes = new ApiRoutes(this.config, this.botManager, this.io);

        // 设置中间件
        this.setupMiddleware();

        // 设置API路由
        this.app.use('/api', this.apiRoutes.getRouter());

        // 设置二维码图片静态文件服务
        this.setupQrCodeStatic();

        // 设置静态文件服务
        this.app.use(express.static(path.join(__dirname, 'public')));

        // 设置WebSocket事件
        this.setupWebSocketEvents();

        // 初始化机器人管理器
        await this.botManager.init();

        // 设置定时任务
        this.setupScheduledTasks();

        // 启动服务器
        this.server.listen(PORT, HOST, () => {
            const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
            console.log(`\n服务器已启动: http://${displayHost}:${PORT}`);
            console.log(`WebUI管理界面: http://${displayHost}:${PORT}`);
            console.log('====================================\n');
        });
    }

    // 设置二维码图片静态文件服务
    setupQrCodeStatic() {
        // 获取真实的工作目录（兼容编译版本）
        const getRealWorkDir = () => {
            if (process.env.ONEBOT_WORK_DIR) {
                return process.env.ONEBOT_WORK_DIR;
            }
            if (process.pkg) {
                return path.dirname(process.execPath);
            }
            return __dirname;
        };

        const realWorkDir = getRealWorkDir();
        const onebotDir = path.isAbsolute(this.config.botRootDir) 
            ? this.config.botRootDir 
            : path.resolve(realWorkDir, this.config.botRootDir);
        
        const routePath = `/${this.config.botRootDir.replace('./', '')}`;
        
        // 创建静态文件中间件实例
        const staticMiddleware = express.static(onebotDir, {
            maxAge: '1m',
            index: false,
            redirect: false,
            fallthrough: false,
            dotfiles: 'deny'
        });
        
        // 中间件：处理二维码文件请求
        this.app.use(routePath, (req, res, next) => {
            // 只允许访问 .png 文件
            if (!req.path.endsWith('.png')) {
                return res.status(403).send('Forbidden');
            }
            
            // 在编译环境下，可能需要调整请求路径
            if (process.pkg && req.path.startsWith('/')) {
                // 移除前导斜杠，让 express.static 正确处理
                req.url = req.path.substring(1);
            }
            
            // 使用静态文件中间件
            staticMiddleware(req, res, (err) => {
                if (err) {
                    console.error(`二维码文件访问错误: ${req.path}`, err);
                    return res.status(404).json({ error: 'File not found' });
                }
                next();
            });
        });
        
        console.log(`二维码图片静态文件服务已设置: ${routePath} -> ${onebotDir} (仅允许.png文件)`);
        console.log(`当前工作目录: ${process.cwd()}`);
        console.log(`真实工作目录: ${realWorkDir}`);
    }

    // 设置中间件
    setupMiddleware() {
        this.app.use(cors());
        this.app.use(express.json({ limit: '50mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));

        // 添加客户端IP检测中间件
        this.app.use((req, res, next) => {
            req.clientIP = this.getClientAddress(req);
            req.serverAddress = this.getServerAddress(req);
            next();
        });

        // Session 配置 - 全局应用
        this.app.use(session({
            secret: 'onebot-manager-secret-enhanced',
            resave: false,
            saveUninitialized: false,
            cookie: { 
                secure: false,
                maxAge: 24 * 60 * 60 * 1000,
                httpOnly: true
            }
        }));

        // 登录检查中间件
        const requireAuth = (req, res, next) => {
            // 排除不需要认证的路径
            const excludePaths = [
                '/socket.io',
                '.html', '.css', '.js', '.ico', '.png', '.jpg', '.gif',
                '/', '/ws', `/${this.config.botRootDir}/`
            ];

            if (excludePaths.some(path => 
                req.path.startsWith(path) || req.path.endsWith(path) || req.path === path
            )) {
                return next();
            }
            
            // 对于登录相关路径，不需要检查认证状态
            if (req.path === '/api/login' || req.path === '/api/logout' || req.path === '/api/auth-status') {
                return next();
            }
            
            // 对于其他API路径，检查认证状态
            if (req.path.startsWith('/api/')) {
                if (!req.session || !req.session.authenticated) {
                    return res.status(401).json({ 
                        success: false, 
                        message: '请先登录',
                        code: 'UNAUTHORIZED'
                    });
                }
            }
            
            next();
        };

        this.app.use(requireAuth);

        // 全局错误处理中间件
        this.app.use((error, req, res, next) => {
            console.error('服务器错误:', error);
            
            if (res.headersSent) {
                return next(error);
            }
            
            res.status(500).json({
                success: false,
                message: '服务器内部错误',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        });
    }

    // 设置WebSocket事件
    setupWebSocketEvents() {
        this.io.on('connection', (socket) => {
            console.log('WebSocket客户端已连接');
            this.botManager.setClientConnected(true);

            // 发送当前机器人列表
            socket.emit('botList', this.botManager.getAllBots());

            // 发送历史日志
            socket.on('getBotLogs', (botId) => {
                const logs = this.botManager.getBotLogs(botId);
                socket.emit('botLogsHistory', { botId, logs });
            });

            // 请求连接信息
            socket.on('getConnectionInfo', () => {
                const request = socket.request;
                const serverAddress = this.getServerAddress(request);
                
                const connectionInfo = {
                    host: serverAddress.hostname,
                    port: serverAddress.port,
                    apiKey: this.config.server.apiKey,
                    clientIP: this.getClientAddress(request),
                    fullAddress: serverAddress.fullHost,
                    httpUrl: serverAddress.baseUrl,
                    wsUrl: serverAddress.wsBaseUrl,
                    addresses: {
                        webUI: serverAddress.baseUrl,
                        wsManager: `${serverAddress.wsBaseUrl}/ws`,
                        httpAPI: `${serverAddress.baseUrl}/api`
                    }
                };
                socket.emit('connectionInfo', connectionInfo);
            });

            socket.on('disconnect', () => {
                console.log('WebSocket客户端已断开');
                this.botManager.setClientConnected(false);
            });
        });
    }

    // 设置定时任务
    setupScheduledTasks() {
        // 清理旧的定时任务
        this.scheduledJobs.forEach(job => job.cancel());
        this.scheduledJobs.clear();

        // 全体重启定时任务
        if (this.config.scheduler.autoRestartAll && this.config.scheduler.autoRestartTime) {
            const [hour, minute] = this.config.scheduler.autoRestartTime.split(':').map(Number);
            
            const restartJob = schedule.scheduleJob(`${minute} ${hour} * * *`, async () => {
                console.log('执行定时全体重启...');
                try {
                    await this.botManager.restartAllBots();
                    console.log('定时全体重启完成');
                } catch (error) {
                    console.error('定时全体重启失败:', error);
                }
            });

            this.scheduledJobs.set('autoRestart', restartJob);
            console.log(`定时全体重启已设置: 每天 ${this.config.scheduler.autoRestartTime}`);
        }

        // 添加进程清理定时任务
        const cleanupJob = schedule.scheduleJob('*/30 * * * *', async () => {
            try {
                if (this.botManager && this.botManager.processManager) {
                    const cleaned = await this.botManager.processManager.cleanupDeadProcesses();
                    if (cleaned > 0) {
                        console.log(`清理了 ${cleaned} 个死进程`);
                    }
                }
            } catch (error) {
                console.error('进程清理失败:', error);
            }
        });

        this.scheduledJobs.set('cleanup', cleanupJob);
        console.log('进程清理定时任务已设置: 每30分钟');
    }

    // 优雅关闭
    async gracefulShutdown() {
        console.log('\n正在关闭服务器...');
        
        try {
            // 取消所有定时任务
            this.scheduledJobs.forEach(job => job.cancel());
            
            // 关闭机器人管理器
            if (this.botManager) {
                await this.botManager.cleanup();
            }
            
            // 关闭WebSocket连接
            this.io.close();
            
            // 关闭HTTP服务器
            this.server.close(() => {
                console.log('服务器已关闭');
                process.exit(0);
            });
            
            // 如果超时还没关闭，强制退出
            setTimeout(() => {
                console.log('强制关闭服务器');
                process.exit(1);
            }, 10000);
            
        } catch (error) {
            console.error('关闭服务器时出错:', error);
            process.exit(1);
        }
    }
}

// 创建并启动服务器
const server = new OneBotManagerServer();

// 增强的错误处理
process.on('uncaughtException', (error) => {
    console.error('未捕获的异常:', error);
    console.error('堆栈跟踪:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('未处理的Promise拒绝:', reason);
    console.error('Promise:', promise);
});

// 优雅关闭信号处理
process.on('SIGINT', () => {
    console.log('\n收到 SIGINT 信号，开始优雅关闭...');
    server.gracefulShutdown();
});

process.on('SIGTERM', () => {
    console.log('\n收到 SIGTERM 信号，开始优雅关闭...');
    server.gracefulShutdown();
});

// 在Windows上处理Ctrl+C
if (os.platform() === 'win32') {
    process.on('SIGBREAK', () => {
        console.log('\n收到 SIGBREAK 信号，开始优雅关闭...');
        server.gracefulShutdown();
    });
}

// 启动应用
console.log('正在启动 OneBot 管理器...');
server.initialize().catch(error => {
    console.error('启动失败:', error);
    console.error('错误详情:', error.stack);
    process.exit(1);
});
