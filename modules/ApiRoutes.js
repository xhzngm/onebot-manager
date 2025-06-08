const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const net = require('net');

class ApiRoutes {
    constructor(config, botManager, io) {
        this.config = config;
        this.botManager = botManager;
        this.io = io;
        this.router = express.Router();
        
        this.setupRoutes();
    }

    setupRoutes() {
        // 认证相关
        this.router.post('/login', this.handleLogin.bind(this));
        this.router.post('/logout', this.handleLogout.bind(this));
        this.router.get('/auth-status', this.handleAuthStatus.bind(this));

        // 机器人管理
        this.router.get('/bots', this.handleGetBots.bind(this));
        this.router.post('/bots', this.handleCreateBot.bind(this));
        this.router.delete('/bots/:botId', this.handleDeleteBot.bind(this));
        this.router.post('/bots/:botId/start', this.handleStartBot.bind(this));
        this.router.post('/bots/:botId/stop', this.handleStopBot.bind(this));
        this.router.post('/bots/:botId/restart', this.handleRestartBot.bind(this));
        this.router.post('/bots/restart-all', this.handleRestartAllBots.bind(this));
        this.router.post('/bots/:botId/toggle-auto-restart', this.handleToggleAutoRestart.bind(this));

        // 机器人配置
        this.router.get('/bots/:botId/config/raw', this.handleGetBotConfigRaw.bind(this));
        this.router.get('/bots/:botId/config/simple', this.handleGetBotConfigSimple.bind(this));
        this.router.post('/bots/:botId/config/raw', this.handleSaveBotConfigRaw.bind(this));
        this.router.post('/bots/:botId/config/simple', this.handleSaveBotConfigSimple.bind(this));
        this.router.post('/bots/:botId/config/create-default', this.handleCreateDefaultConfig.bind(this));

        // 机器人日志 - 修复API路径
        this.router.get('/logs/:botId', this.handleGetBotLogs.bind(this));
        this.router.delete('/logs/:botId', this.handleClearBotLogs.bind(this));

        // 机器人状态检测 - 改进功能
        this.router.get('/bots/:botId/status', this.handleCheckBotStatus.bind(this));
        this.router.get('/bots/:botId/qrcode', this.handleCheckQrCode.bind(this));

        // 扫码登录相关 - 新增功能
        this.router.get('/bots/:botId/qrcode/check', this.handleQrCodeCheck.bind(this));
        this.router.post('/bots/:botId/qrcode/refresh', this.handleRefreshQrCode.bind(this));
        this.router.delete('/bots/:botId/qrcode', this.handleDeleteQrCode.bind(this));

        // 系统配置
        this.router.get('/config', this.handleGetConfig.bind(this));
        this.router.post('/config', this.handleSaveConfig.bind(this));

        // 连接信息
        this.router.get('/connection-info', this.handleGetConnectionInfo.bind(this));

        // 系统操作
        this.router.get('/system-info', this.handleGetSystemInfo.bind(this));
        this.router.post('/system/clear-logs', this.handleClearSystemLogs.bind(this));
        this.router.post('/system/restart', this.handleRestartServer.bind(this));

        // 错误处理中间件
        this.router.use(this.handleError.bind(this));
    }

    // 认证处理
    async handleLogin(req, res) {
        try {
            const { key } = req.body;
            
            if (!key) {
                return res.status(400).json({
                    success: false,
                    message: '请提供API Key'
                });
            }

            if (key === this.config.server.apiKey) {
                req.session.authenticated = true;
                res.json({
                    success: true,
                    message: '登录成功'
                });
            } else {
                res.status(401).json({
                    success: false,
                    message: 'API Key错误'
                });
            }
        } catch (error) {
            console.error('登录处理失败:', error);
            res.status(500).json({
                success: false,
                message: '服务器错误'
            });
        }
    }

    async handleLogout(req, res) {
        try {
            req.session.destroy((err) => {
                if (err) {
                    console.error('登出失败:', err);
                    return res.status(500).json({
                        success: false,
                        message: '登出失败'
                    });
                }
                
                res.json({
                    success: true,
                    message: '已退出登录'
                });
            });
        } catch (error) {
            console.error('登出处理失败:', error);
            res.status(500).json({
                success: false,
                message: '服务器错误'
            });
        }
    }

    async handleAuthStatus(req, res) {
        try {
            res.json({
                authenticated: req.session?.authenticated || false
            });
        } catch (error) {
            console.error('认证状态检查失败:', error);
            res.status(500).json({
                authenticated: false
            });
        }
    }

    // 机器人管理
    async handleGetBots(req, res) {
        try {
            const bots = this.botManager.getAllBots();
            res.json(bots);
        } catch (error) {
            console.error('获取机器人列表失败:', error);
            res.status(500).json({
                success: false,
                message: '获取机器人列表失败'
            });
        }
    }

    async handleCreateBot(req, res) {
        try {
            const { botId, config } = req.body;
            
            if (!botId || !config) {
                return res.status(400).json({
                    success: false,
                    message: '缺少必要参数'
                });
            }

            const result = await this.botManager.createBot(botId, config);
            res.json(result);
        } catch (error) {
            console.error('创建机器人失败:', error);
            res.status(500).json({
                success: false,
                message: '创建机器人失败: ' + error.message
            });
        }
    }

    async handleDeleteBot(req, res) {
        try {
            const { botId } = req.params;
            const result = await this.botManager.deleteBot(botId);
            res.json(result);
        } catch (error) {
            console.error('删除机器人失败:', error);
            res.status(500).json({
                success: false,
                message: '删除机器人失败: ' + error.message
            });
        }
    }

    async handleStartBot(req, res) {
        try {
            const { botId } = req.params;
            const result = await this.botManager.startBot(botId);
            res.json(result);
        } catch (error) {
            console.error('启动机器人失败:', error);
            res.status(500).json({
                success: false,
                message: '启动机器人失败: ' + error.message
            });
        }
    }

    async handleStopBot(req, res) {
        try {
            const { botId } = req.params;
            const result = await this.botManager.stopBot(botId);
            res.json(result);
        } catch (error) {
            console.error('停止机器人失败:', error);
            res.status(500).json({
                success: false,
                message: '停止机器人失败: ' + error.message
            });
        }
    }

    async handleRestartBot(req, res) {
        try {
            const { botId } = req.params;
            const result = await this.botManager.restartBot(botId);
            res.json(result);
        } catch (error) {
            console.error('重启机器人失败:', error);
            res.status(500).json({
                success: false,
                message: '重启机器人失败: ' + error.message
            });
        }
    }

    async handleRestartAllBots(req, res) {
        try {
            const result = await this.botManager.restartAllBots();
            res.json(result);
        } catch (error) {
            console.error('重启所有机器人失败:', error);
            res.status(500).json({
                success: false,
                message: '重启所有机器人失败: ' + error.message
            });
        }
    }

    async handleToggleAutoRestart(req, res) {
        try {
            const { botId } = req.params;
            const result = await this.botManager.toggleAutoRestart(botId);
            res.json(result);
        } catch (error) {
            console.error('切换自动重启失败:', error);
            res.status(500).json({
                success: false,
                message: '切换自动重启失败: ' + error.message
            });
        }
    }

    // 机器人配置处理
    async handleGetBotConfigRaw(req, res) {
        try {
            const { botId } = req.params;
            const config = await this.botManager.getBotConfig(botId);
            res.json(config);
        } catch (error) {
            console.error('获取机器人原始配置失败:', error);
            res.status(500).json({
                success: false,
                message: '获取配置失败: ' + error.message
            });
        }
    }

    async handleGetBotConfigSimple(req, res) {
        try {
            const { botId } = req.params;
            const config = await this.botManager.getBotConfig(botId);
            const simpleConfig = this.botManager.getSimpleBotConfig(config);
            res.json(simpleConfig);
        } catch (error) {
            console.error('获取机器人简化配置失败:', error);
            res.status(500).json({
                success: false,
                message: '获取配置失败: ' + error.message
            });
        }
    }

    async handleSaveBotConfigRaw(req, res) {
        try {
            const { botId } = req.params;
            const config = req.body;
            
            if (!config || typeof config !== 'object') {
                return res.status(400).json({
                    success: false,
                    message: '无效的配置格式'
                });
            }

            const result = await this.botManager.saveBotConfig(botId, config);
            res.json(result);
        } catch (error) {
            console.error('保存机器人原始配置失败:', error);
            res.status(500).json({
                success: false,
                message: '保存配置失败: ' + error.message
            });
        }
    }

    async handleSaveBotConfigSimple(req, res) {
        try {
            const { botId } = req.params;
            const simpleConfig = req.body;
            
            if (!simpleConfig || typeof simpleConfig !== 'object') {
                return res.status(400).json({
                    success: false,
                    message: '无效的配置格式'
                });
            }

            const fullConfig = this.botManager.convertFromSimpleConfig(simpleConfig);
            const result = await this.botManager.saveBotConfig(botId, fullConfig);
            res.json(result);
        } catch (error) {
            console.error('保存机器人简化配置失败:', error);
            res.status(500).json({
                success: false,
                message: '保存配置失败: ' + error.message
            });
        }
    }

    async handleCreateDefaultConfig(req, res) {
        try {
            const { botId } = req.params;
            
            const defaultConfig = {
                "$schema": "https://raw.githubusercontent.com/LagrangeDev/Lagrange.Core/master/Lagrange.OneBot/Resources/appsettings_schema.json",
                "Account": {
                    "Uin": 0,
                    "Password": "",
                    "Protocol": "Linux",
                    "AutoReconnect": true,
                    "GetOptimumServer": true
                },
                "Message": {
                    "IgnoreSelf": true,
                    "StringPost": false
                },
                "QrCode": {
                    "ConsoleCompatibilityMode": false
                },
                "Logging": {
                    "LogLevel": {
                        "Default": "Information",
                        "Microsoft": "Warning",
                        "Microsoft.Hosting.Lifetime": "Information"
                    }
                },
                "SignServerUrl": this.config.defaultSignServer || "https://sign.lagrangecore.org/api/sign",
                "SignProxyUrl": "",
                "MusicSignServerUrl": "",
                "Implementations": [
                    {
                        "Type": "ForwardWebSocket",
                        "Host": "127.0.0.1",
                        "Port": 8081,
                        "HeartBeatInterval": 5000,
                        "HeartBeatEnable": true,
                        "AccessToken": ""
                    }
                ]
            };

            res.json({
                success: true,
                message: '默认配置创建成功',
                config: defaultConfig
            });
        } catch (error) {
            console.error('创建默认配置失败:', error);
            res.status(500).json({
                success: false,
                message: '创建默认配置失败: ' + error.message
            });
        }
    }

    // 机器人日志处理 - 修复API路径
    async handleGetBotLogs(req, res) {
        try {
            const { botId } = req.params;
            const logs = await this.botManager.getBotLogs(botId);
            res.json(logs || []);
        } catch (error) {
            console.error('获取机器人日志失败:', error);
            res.status(500).json([]);
        }
    }

    async handleClearBotLogs(req, res) {
        try {
            const { botId } = req.params;
            await this.botManager.clearBotLogs(botId);
            res.json({
                success: true,
                message: '日志清理完成'
            });
        } catch (error) {
            console.error('清理机器人日志失败:', error);
            res.status(500).json({
                success: false,
                message: '清理日志失败: ' + error.message
            });
        }
    }

    // 机器人状态检测 - 改进功能
    async handleCheckBotStatus(req, res) {
        try {
            const { botId } = req.params;
            const bot = this.botManager.bots.get(botId);
            
            if (!bot) {
                return res.status(404).json({
                    success: false,
                    message: '机器人不存在'
                });
            }

            // 检测端口是否在线
            const isOnline = await this.checkPortStatus(bot);
            
            res.json({
                success: true,
                status: bot.status,
                isOnline: isOnline,
                loginStatus: bot.loginStatus,
                hasQrCode: bot.hasQrCode
            });
        } catch (error) {
            console.error('检查机器人状态失败:', error);
            res.status(500).json({
                success: false,
                message: '检查状态失败: ' + error.message
            });
        }
    }

    // 检测端口状态 - 改进版本
    async checkPortStatus(bot) {
        return new Promise((resolve) => {
            try {
                if (!bot.config || !bot.config.Implementations || bot.config.Implementations.length === 0) {
                    resolve(false);
                    return;
                }

                const impl = bot.config.Implementations[0];
                if (!impl || !impl.Port) {
                    resolve(false);
                    return;
                }

                const socket = new net.Socket();
                const timeout = 3000;

                socket.setTimeout(timeout);
                
                socket.connect(impl.Port, impl.Host || '127.0.0.1', () => {
                    socket.destroy();
                    resolve(true);
                });

                socket.on('error', () => {
                    resolve(false);
                });

                socket.on('timeout', () => {
                    socket.destroy();
                    resolve(false);
                });
            } catch (error) {
                resolve(false);
            }
        });
    }

    // 二维码检测 - 改进功能
    async handleCheckQrCode(req, res) {
        try {
            const { botId } = req.params;
            const bot = this.botManager.bots.get(botId);
            
            if (!bot) {
                return res.status(404).json({
                    success: false,
                    message: '机器人不存在'
                });
            }

            // 检测二维码文件
            const qrCodeInfo = await this.findQrCodeFile(botId, bot);
            
            res.json({
                success: true,
                hasQrCode: qrCodeInfo.hasQrCode,
                qrCodePath: qrCodeInfo.qrCodePath,
                qrCodeUrl: qrCodeInfo.qrCodeUrl,
                uin: bot.uin || bot.config?.Account?.Uin,
                botStatus: bot.status,
                loginStatus: bot.loginStatus
            });
        } catch (error) {
            console.error('检查二维码失败:', error);
            res.status(500).json({
                success: false,
                message: '检查二维码失败: ' + error.message
            });
        }
    }

    // 扫码登录相关API - 新增功能
    async handleQrCodeCheck(req, res) {
        try {
            const { botId } = req.params;
            const bot = this.botManager.bots.get(botId);
            
            if (!bot) {
                return res.status(404).json({
                    success: false,
                    message: '机器人不存在'
                });
            }

            const qrCodeInfo = await this.findQrCodeFile(botId, bot);
            
            res.json({
                success: true,
                hasQrCode: qrCodeInfo.hasQrCode,
                qrCodeUrl: qrCodeInfo.qrCodeUrl,
                uin: bot.uin || bot.config?.Account?.Uin,
                message: qrCodeInfo.hasQrCode ? '请使用QQ/TIM扫码登录\n勾选下次登录无需确认\n请勿使用截图相册扫码' : '未检测到二维码文件'
            });
        } catch (error) {
            console.error('检查二维码状态失败:', error);
            res.status(500).json({
                success: false,
                message: '检查二维码状态失败: ' + error.message
            });
        }
    }

    async handleRefreshQrCode(req, res) {
        try {
            const { botId } = req.params;
            const bot = this.botManager.bots.get(botId);
            
            if (!bot) {
                return res.status(404).json({
                    success: false,
                    message: '机器人不存在'
                });
            }

            // 刷新二维码 - 重启机器人进程
            if (bot.status === 'running') {
                const result = await this.botManager.restartBot(botId);
                res.json({
                    success: result.success,
                    message: result.success ? '正在重新生成二维码，请稍候...' : result.message
                });
            } else {
                // 如果机器人未运行，启动它
                const result = await this.botManager.startBot(botId);
                res.json({
                    success: result.success,
                    message: result.success ? '正在启动机器人并生成二维码...' : result.message
                });
            }
        } catch (error) {
            console.error('刷新二维码失败:', error);
            res.status(500).json({
                success: false,
                message: '刷新二维码失败: ' + error.message
            });
        }
    }

    async handleDeleteQrCode(req, res) {
        try {
            const { botId } = req.params;
            const bot = this.botManager.bots.get(botId);
            
            if (!bot) {
                return res.status(404).json({
                    success: false,
                    message: '机器人不存在'
                });
            }

            // 删除二维码文件
            const botDir = path.join(this.config.botRootDir, botId);
            const uin = bot.uin || bot.config?.Account?.Uin;
            
            let deletedCount = 0;
            
            try {
                // 删除特定UIN的二维码
                if (uin && uin !== 0) {
                    const qrPath = path.join(botDir, `qr-${uin}.png`);
                    if (await fs.pathExists(qrPath)) {
                        await fs.remove(qrPath);
                        deletedCount++;
                    }
                }
                
                // 删除通用二维码
                const qrPath0 = path.join(botDir, 'qr-0.png');
                if (await fs.pathExists(qrPath0)) {
                    await fs.remove(qrPath0);
                    deletedCount++;
                }
                
                // 删除所有二维码文件
                if (await fs.pathExists(botDir)) {
                    const files = await fs.readdir(botDir);
                    const qrFiles = files.filter(file => file.startsWith('qr-') && file.endsWith('.png'));
                    
                    for (const qrFile of qrFiles) {
                        await fs.remove(path.join(botDir, qrFile));
                        deletedCount++;
                    }
                }
                
                // 更新机器人状态
                if (bot.hasQrCode) {
                    bot.hasQrCode = false;
                    bot.qrCodePath = null;
                    bot.lastUpdate = Date.now();
                    this.botManager.emitBotStatusUpdate(botId);
                }
                
                res.json({
                    success: true,
                    message: `已删除 ${deletedCount} 个二维码文件`
                });
            } catch (fileError) {
                res.json({
                    success: true,
                    message: '二维码文件清理完成'
                });
            }
        } catch (error) {
            console.error('删除二维码失败:', error);
            res.status(500).json({
                success: false,
                message: '删除二维码失败: ' + error.message
            });
        }
    }

    // 查找二维码文件 - 改进版本
    async findQrCodeFile(botId, bot) {
        try {
            const botDir = path.join(this.config.botRootDir, botId);
            const uin = bot.uin || bot.config?.Account?.Uin;
            
            // 检查特定UIN的二维码文件
            if (uin && uin !== 0) {
                const qrPath = path.join(botDir, `qr-${uin}.png`);
                if (await fs.pathExists(qrPath)) {
                    const qrUrl = `/${this.config.botRootDir.replace('./', '')}/${botId}/qr-${uin}.png`;
                    return {
                        hasQrCode: true,
                        qrCodePath: qrPath,
                        qrCodeUrl: qrUrl
                    };
                }
            }

            // 检查通用二维码文件
            const qrPath0 = path.join(botDir, 'qr-0.png');
            if (await fs.pathExists(qrPath0)) {
                const qrUrl = `/${this.config.botRootDir.replace('./', '')}/${botId}/qr-0.png`;
                return {
                    hasQrCode: true,
                    qrCodePath: qrPath0,
                    qrCodeUrl: qrUrl
                };
            }

            // 检查所有qr-*.png文件
            if (await fs.pathExists(botDir)) {
                const files = await fs.readdir(botDir);
                const qrFiles = files.filter(file => file.startsWith('qr-') && file.endsWith('.png'));
                
                if (qrFiles.length > 0) {
                    const qrFile = qrFiles[0];
                    const qrPath = path.join(botDir, qrFile);
                    const qrUrl = `/${this.config.botRootDir.replace('./', '')}/${botId}/${qrFile}`;
                    return {
                        hasQrCode: true,
                        qrCodePath: qrPath,
                        qrCodeUrl: qrUrl
                    };
                }
            }

            return {
                hasQrCode: false,
                qrCodePath: null,
                qrCodeUrl: null
            };
        } catch (error) {
            console.error('查找二维码文件失败:', error);
            return {
                hasQrCode: false,
                qrCodePath: null,
                qrCodeUrl: null
            };
        }
    }

    // 系统配置处理
    async handleGetConfig(req, res) {
        try {
            const configToSend = { ...this.config };
            res.json(configToSend);
        } catch (error) {
            console.error('获取系统配置失败:', error);
            res.status(500).json({
                success: false,
                message: '获取配置失败: ' + error.message
            });
        }
    }

    async handleSaveConfig(req, res) {
        try {
            const newConfig = req.body;
            
            if (!newConfig || typeof newConfig !== 'object') {
                return res.status(400).json({
                    success: false,
                    message: '无效的配置格式'
                });
            }

            // 特殊处理API Key
            if (newConfig.server && (!newConfig.server.apiKey || newConfig.server.apiKey.trim() === '')) {
                if (this.config.server && this.config.server.apiKey) {
                    newConfig.server.apiKey = this.config.server.apiKey;
                }
            }

            const mergedConfig = this.mergeConfig(this.config, newConfig);
            
            const configPath = path.join(__dirname, '..', 'config.json');
            await fs.writeJson(configPath, mergedConfig, { spaces: 2 });
            
            Object.assign(this.config, mergedConfig);
            
            console.log('系统配置保存成功');
            res.json({
                success: true,
                message: '配置保存成功，重启生效'
            });
        } catch (error) {
            console.error('保存系统配置失败:', error);
            res.status(500).json({
                success: false,
                message: '保存配置失败: ' + error.message
            });
        }
    }

    mergeConfig(target, source) {
        const result = { ...target };
        
        for (const key in source) {
            if (source.hasOwnProperty(key)) {
                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    result[key] = this.mergeConfig(target[key] || {}, source[key]);
                } else {
                    result[key] = source[key];
                }
            }
        }
        
        return result;
    }

    // 连接信息处理
    async handleGetConnectionInfo(req, res) {
        try {
            const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
            const host = req.get('host') || `${this.config.server.host}:${this.config.server.port}`;
            const hostname = req.hostname || this.config.server.host;
            const actualPort = req.headers['x-forwarded-port'] || this.config.server.port;
            
            const connectionInfo = {
                host: hostname === '0.0.0.0' ? '127.0.0.1' : hostname,
                port: actualPort,
                apiKey: this.config.server.apiKey,
                clientIP: req.ip || req.connection.remoteAddress || '127.0.0.1',
                fullAddress: host,
                httpUrl: `${protocol}://${host}`,
                addresses: {
                    webUI: `${protocol}://${host}`,
                    httpAPI: `${protocol}://${host}/api`
                }
            };
            
            res.json(connectionInfo);
        } catch (error) {
            console.error('获取连接信息失败:', error);
            res.status(500).json({
                success: false,
                message: '获取连接信息失败: ' + error.message
            });
        }
    }

    // 系统信息
    async handleGetSystemInfo(req, res) {
        try {
            const systemInfo = {
                platform: os.platform(),
                arch: os.arch(),
                nodeVersion: process.version,
                uptime: process.uptime(),
                memoryUsage: process.memoryUsage(),
                executablePath: this.config.executablePath,
                botRootDir: path.resolve(this.config.botRootDir),
                logDir: path.resolve(this.config.logDir),
                configPath: path.join(__dirname, '..', 'config.json'),
                pid: process.pid
            };
            
            res.json(systemInfo);
        } catch (error) {
            console.error('获取系统信息失败:', error);
            res.status(500).json({
                success: false,
                message: '获取系统信息失败: ' + error.message
            });
        }
    }

    async handleClearSystemLogs(req, res) {
        try {
            const logDir = path.resolve(this.config.logDir);
            
            if (await fs.pathExists(logDir)) {
                const files = await fs.readdir(logDir);
                
                for (const file of files) {
                    if (file.endsWith('.log') || file.endsWith('.txt')) {
                        await fs.remove(path.join(logDir, file));
                    }
                }
            }
            
            res.json({
                success: true,
                message: '系统日志清理完成'
            });
        } catch (error) {
            console.error('清理系统日志失败:', error);
            res.status(500).json({
                success: false,
                message: '清理日志失败: ' + error.message
            });
        }
    }

    async handleRestartServer(req, res) {
        try {
            res.json({
                success: true,
                message: '服务器将在3秒后重启'
            });
            
            setTimeout(() => {
                console.log('收到重启请求，正在重启服务器...');
                process.exit(0);
            }, 3000);
        } catch (error) {
            console.error('重启服务器失败:', error);
            res.status(500).json({
                success: false,
                message: '重启服务器失败: ' + error.message
            });
        }
    }

    // 错误处理中间件
    handleError(error, req, res, next) {
        console.error('API路由错误:', error);
        
        if (res.headersSent) {
            return next(error);
        }
        
        res.status(500).json({
            success: false,
            message: '服务器内部错误',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }

    getRouter() {
        return this.router;
    }
}

module.exports = ApiRoutes;
