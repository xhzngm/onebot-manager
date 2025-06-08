const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const AdmZip = require('adm-zip');
const cliProgress = require('cli-progress');
const { program } = require('commander');
const readline = require('readline');

const MB = 1024 ** 2;

// 常量定义
const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/63.0.3239.132 Safari/537.36 QIHU 360SE'
};

// 确保所有代理URL都以斜杠结尾
const githubProxyUrls = [
  "https://get.2sb.org/",
  "https://gh.h233.eu.org/",
  "https://gh.ddlc.top/",
  "https://slink.ltd/",
  "https://gh.con.sh/",
  "https://cors.isteed.cc/",
  "https://hub.gitmirror.com/",
  "https://sciproxy.com/",
  "https://ghproxy.cc/",
  "https://cf.ghproxy.cc/",
  "https://www.ghproxy.cc/",
  "https://ghproxy.cn/",
  "https://www.ghproxy.cn/",
  "https://gh.jiasu.in/",
  "https://dgithub.xyz/",
  "https://download.ixnic.net/",
  "https://download.nuaa.cf/",
  "https://download.scholar.rr.nu/",
  "https://download.yzuu.cf/",
  "https://mirror.ghproxy.com/",
  "https://ghproxy.net/",
  "https://kkgithub.com/",
  "https://gitclone.com/",
  "https://hub.incept.pw/",
  "https://github.moeyy.xyz/"
];

// 路径设置 - 修改：直接使用根目录作为安装目录
const workPath = path.dirname(require.main.filename);
const onebotPath = path.join(workPath, "OneBot"); // 保留备用，但不再作为默认安装目录

// 全局代理控制变量 - 默认使用选项5（仅下载使用代理）
let useProxyForAPI = false;     // 控制API是否使用代理
let useProxyForDownload = true; // 控制下载是否使用代理

// 询问用户输入
function askQuestion(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

async function askProxyPreference(silentInstallation) {
  if (silentInstallation) {
    // 静默模式下使用默认设置（选项5：仅下载使用代理）
    useProxyForAPI = false;
    useProxyForDownload = true;
    return;
  }

  console.log('\n=== 代理设置 ===');
  console.log('GitHub访问可能需要使用代理来提高下载速度');
  console.log('1. 自动选择  - 智能选择最佳连接方式');
  console.log('2. 强制使用代理 - 所有请求都通过代理');
  console.log('3. 禁用所有代理 - 只使用直连');
  console.log('4. 仅API使用代理 - 只有版本检查使用代理');
  console.log('5. 仅下载使用代理 (推荐) - 只有文件下载使用代理');

  const choice = await askQuestion('\n请选择代理设置 (1-5) [默认: 5]: ');

  switch (choice.trim()) {
    case '1':
      useProxyForAPI = true;
      useProxyForDownload = true;
      console.log('✅ 已设置为自动选择（智能模式）');
      break;
    case '2':
      useProxyForAPI = true;
      useProxyForDownload = true;
      console.log('✅ 已设置为强制使用代理');
      break;
    case '3':
      useProxyForAPI = false;
      useProxyForDownload = false;
      console.log('✅ 已设置为禁用所有代理');
      break;
    case '4':
      useProxyForAPI = true;
      useProxyForDownload = false;
      console.log('✅ 已设置为仅API使用代理');
      break;
    case '5':
    case '':
    default:
      useProxyForAPI = false;
      useProxyForDownload = true;
      console.log('✅ 已设置为仅下载使用代理');
      break;
  }
}

// 测试网络连接
async function testConnection(url, timeout = 5000) {
  try {
    const response = await axios.head(url, { 
      timeout,
      headers: {
        'User-Agent': headers['User-Agent']
      }
    });
    return response.status >= 200 && response.status < 300;
  } catch (error) {
    return false;
  }
}

// 获取可用的代理 - 修复：严格遵循用户的代理选择
async function getWorkingProxyForDownload() {
  // 如果用户选择不使用代理，直接返回null
  if (!useProxyForDownload) {
    console.log('根据用户设置，下载将不使用代理');
    return null;
  }
  
  console.log('正在检测网络质量和最佳下载代理...');
  console.log('用户选择了仅下载使用代理，将强制使用代理下载');
  
  // 先测试官方GitHub下载站点（仅用于信息显示）
  const directTest = await testConnection("https://github.com", 3000);
  if (directTest) {
    console.log("GitHub直连良好，但根据用户设置将使用代理下载");
  } else {
    console.log("GitHub直连较慢，将使用代理下载");
  }
  
  console.log('正在测试代理服务器...');
  
  // 逐个测试代理
  for (const proxy of githubProxyUrls) {
    try {
      const proxyUrl = `${proxy}https://github.com`;
      const isWorking = await testConnection(proxyUrl, 8000);
      
      if (isWorking) {
        console.log(`代理 ${proxy} 可用`);
        console.log(`选择代理: ${proxy}`);
        return proxy;
      } else {
        console.log(`代理 ${proxy} 不可用`);
      }
    } catch (error) {
      console.log(`代理 ${proxy} 测试失败`);
    }
  }
  
  console.log("未找到可用的代理服务器，将回退到直连");
  return null;
}

// 获取所有版本信息 - 根据用户选择决定是否使用代理
async function getAllReleases() {
  // 使用/releases而不是/releases/latest，参考Python代码
  const apiUrl = "https://api.github.com/repos/LagrangeDev/Lagrange.Core/releases";
  
  console.log('正在获取 Lagrange.Core 版本信息...');
  
  // 首先尝试直连API
  try {
    console.log('尝试直连GitHub API...');
    const response = await axios.get(apiUrl, {
      headers,
      timeout: 15000
    });
    
    if (response.status === 200) {
      console.log('直连API成功');
      const releases = response.data;
      if (releases && releases.length > 0) {
        // 寻找第一个有assets的release
        for (const release of releases) {
          if (release.assets && release.assets.length > 0) {
            console.log(`找到有效版本: ${release.tag_name}`);
            return release;
          }
        }
        throw new Error('所有版本都没有可下载的文件');
      } else {
        throw new Error('未找到任何版本');
      }
    }
  } catch (error) {
    console.log(`直连API失败: ${error.message}`);
    
    // 如果用户选择不使用代理，直接报错
    if (!useProxyForAPI) {
      throw new Error('直连API失败且用户设置不使用代理');
    }
    
    console.log('尝试通过代理获取版本信息...');
  }
  
  // 如果用户允许使用代理且直连失败，尝试通过代理访问API
  if (useProxyForAPI) {
    for (const proxy of githubProxyUrls.slice(0, 8)) { // 测试更多代理
      try {
        console.log(`尝试代理 ${proxy}...`);
        const proxyApiUrl = `${proxy}${apiUrl}`;
        const response = await axios.get(proxyApiUrl, {
          headers,
          timeout: 15000
        });
        
        if (response.status === 200) {
          console.log(`通过代理 ${proxy} 获取版本信息成功`);
          const releases = response.data;
          console.log(`获取到 ${releases.length} 个版本`);
          
          if (releases && releases.length > 0) {
            // 寻找第一个有assets的release
            for (let i = 0; i < releases.length; i++) {
              const release = releases[i];
              console.log(`检查版本 ${release.tag_name}...`);
              if (release.assets && release.assets.length > 0) {
                console.log(`找到有效版本: ${release.tag_name}，包含 ${release.assets.length} 个文件`);
                return release;
              } else {
                console.log(`版本 ${release.tag_name} 没有可下载的文件`);
              }
            }
            throw new Error('所有版本都没有可下载的文件');
          } else {
            throw new Error('未找到任何版本');
          }
        }
      } catch (error) {
        console.log(`代理 ${proxy} API访问失败: ${error.message}`);
      }
    }
  }
  
  throw new Error('获取版本信息失败：所有方式都无法访问GitHub API');
}

// 格式化文件大小
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 格式化速度
function formatSpeed(bytesPerSecond) {
  return formatBytes(bytesPerSecond) + '/s';
}

// 增强的下载函数
async function downloadWithProgress(url, fileName, retryTimes = 3, silentInstallation = false) {
  let bar;
  let startTime = Date.now();
  let lastTime = startTime;
  let lastDownloaded = 0;
  
  try {
    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'stream',
      headers,
      timeout: 30000
    });

    const totalSize = parseInt(response.headers['content-length']) || 0;
    
    if (!silentInstallation && totalSize > 0) {
      bar = new cliProgress.SingleBar({
        format: '下载进度 [{bar}] {percentage}% | 速度: {speed} | ETA: {eta}s | {value}/{total}',
        barCompleteChar: '█',
        barIncompleteChar: '░',
        hideCursor: true
      });
      bar.start(totalSize, 0, {
        speed: '计算中...',
        eta: '计算中...'
      });
    }
    
    const writeStream = fs.createWriteStream(fileName);
    let downloaded = 0;
    
    response.data.on('data', (chunk) => {
      downloaded += chunk.length;
      
      if (bar) {
        const currentTime = Date.now();
        const timeDiff = currentTime - lastTime;
        
        if (timeDiff >= 500) {
          const bytesDiff = downloaded - lastDownloaded;
          const speed = (bytesDiff / timeDiff) * 1000;
          const eta = totalSize > 0 ? Math.round((totalSize - downloaded) / speed) : 0;
          
          bar.update(downloaded, {
            speed: formatSpeed(speed),
            eta: eta > 0 ? eta : 0
          });
          
          lastTime = currentTime;
          lastDownloaded = downloaded;
        } else {
          bar.update(downloaded);
        }
      }
    });
    
    response.data.pipe(writeStream);
    
    return new Promise((resolve, reject) => {
      writeStream.on('finish', () => {
        if (bar) {
          const totalTime = (Date.now() - startTime) / 1000;
          const avgSpeed = downloaded / totalTime;
          bar.update(downloaded, {
            speed: formatSpeed(avgSpeed),
            eta: 0
          });
          bar.stop();
          console.log(`\n下载完成! 平均速度: ${formatSpeed(avgSpeed)}, 总用时: ${totalTime.toFixed(1)}秒`);
        }
        resolve(fileName);
      });
      
      writeStream.on('error', (err) => {
        if (bar) bar.stop();
        fs.unlink(fileName, () => {});
        reject(err);
      });
      
      response.data.on('error', (err) => {
        if (bar) bar.stop();
        writeStream.destroy();
        fs.unlink(fileName, () => {});
        reject(err);
      });
    });
    
  } catch (error) {
    if (bar) bar.stop();
    
    if (retryTimes > 0) {
      if (!silentInstallation) {
        console.log(`下载失败，正在重试... (还剩${retryTimes}次重试机会)`);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
      return downloadWithProgress(url, fileName, retryTimes - 1, silentInstallation);
    }
    
    throw new Error(`下载失败: ${error.message}`);
  }
}

// 智能选择系统架构对应的文件 - 参考Python代码逻辑
function selectReleaseForSystem(assets) {
  const platform = os.platform();
  const arch = os.arch();
  
  console.log(`检测到系统: ${platform} ${arch}`);
  
  let systemName, archName;
  
  // 参考Python代码的系统平台映射
  if (platform === 'win32') {
    systemName = 'win';
  } else if (platform === 'linux') {
    systemName = 'linux';
  } else if (platform === 'darwin') {
    systemName = 'osx';
  } else {
    systemName = 'linux'; // 默认
  }
  
  // 参考Python代码的架构映射
  let cpuArchitecture = arch;
  if (arch === 'x64' || arch === 'x86_64') {
    cpuArchitecture = 'x64';
  } else if (arch === 'arm64') {
    cpuArchitecture = 'arm64';
  } else if (arch === 'arm') {
    cpuArchitecture = 'arm';
  } else if (arch === 'ia32') {
    cpuArchitecture = 'x86';
  } else {
    cpuArchitecture = 'x64'; // 默认
  }
  
  // 特殊处理：参考Python代码
  if (platform === 'win32') {
    if (cpuArchitecture === 'arm64') {
      cpuArchitecture = 'x64';
    } else if (cpuArchitecture === 'arm') {
      cpuArchitecture = 'x86';
    }
  } else if (platform === 'darwin') {
    if (cpuArchitecture !== 'arm64' && cpuArchitecture !== 'arm') {
      cpuArchitecture = 'x64';
    }
  }
  
  console.log(`寻找匹配: ${systemName} + ${cpuArchitecture}`);
  
  // 查找匹配的asset
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    const fileName = asset.name.toLowerCase();
    
    if (fileName.includes(systemName) && fileName.includes(cpuArchitecture)) {
      console.log(`自动选择: ${asset.name}`);
      return { asset, index: i };
    }
  }
  
  // 如果没找到精确匹配，尝试只匹配系统
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    const fileName = asset.name.toLowerCase();
    
    if (fileName.includes(systemName)) {
      console.log(`找到系统匹配: ${asset.name}`);
      return { asset, index: i };
    }
  }
  
  // 如果还是没找到，返回第一个
  if (assets.length > 0) {
    console.log(`使用默认选择: ${assets[0].name}`);
    return { asset: assets[0], index: 0 };
  }
  
  throw new Error('没有找到任何可下载的文件');
}

// 智能解压函数 - 避免深层嵌套路径
function extractZipSmart(zipPath, targetDir) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  
  // 查找可执行文件
  const platform = os.platform();
  const executableName = platform === 'win32' ? 'Lagrange.OneBot.exe' : 'Lagrange.OneBot';
  
  let executableEntry = null;
  let rootDir = null;
  
  // 寻找可执行文件和根目录
  for (const entry of entries) {
    if (entry.entryName.endsWith(executableName)) {
      executableEntry = entry;
      // 获取可执行文件所在的目录路径
      const pathParts = entry.entryName.split('/');
      if (pathParts.length > 1) {
        rootDir = pathParts.slice(0, -1).join('/') + '/';
      }
      break;
    }
  }
  
  if (!executableEntry) {
    throw new Error(`未找到可执行文件 ${executableName}`);
  }
  
  console.log(`找到可执行文件: ${executableEntry.entryName}`);
  
  // 提取所有相关文件到目标目录，但去掉深层嵌套路径
  for (const entry of entries) {
    if (rootDir && entry.entryName.startsWith(rootDir)) {
      // 计算相对路径（去掉根目录前缀）
      const relativePath = entry.entryName.substring(rootDir.length);
      
      if (relativePath && !entry.isDirectory) {
        const targetPath = path.join(targetDir, relativePath);
        const targetDirPath = path.dirname(targetPath);
        
        // 确保目标目录存在
        if (!fs.existsSync(targetDirPath)) {
          fs.mkdirSync(targetDirPath, { recursive: true });
        }
        
        // 提取文件
        fs.writeFileSync(targetPath, entry.getData());
        
        // 设置可执行权限（Linux/macOS）
        if (platform !== 'win32' && relativePath === executableName) {
          fs.chmodSync(targetPath, '755');
        }
      }
    }
  }
  
  console.log(`已智能解压到: ${targetDir}`);
  console.log(`可执行文件路径: ${path.join(targetDir, executableName)}`);
}

// 主下载函数 - 修改：默认下载到根目录
async function downloadLagrange(silentInstallation = false, targetDir = workPath) {
  try {
    // 创建目标目录（如果不是根目录的话）
    if (targetDir !== workPath && !fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    console.log('\n=== Lagrange.OneBot 自动下载器 ===');
    console.log(`目标安装目录: ${targetDir}`);
    
    // 询问代理设置
    await askProxyPreference(silentInstallation);
    
    // 显示当前代理设置
    if (!silentInstallation) {
      console.log(`\n当前代理设置: API ${useProxyForAPI ? '启用' : '禁用'}, 下载 ${useProxyForDownload ? '启用' : '禁用'}`);
    }
    
    // 获取版本信息
    const latestRelease = await getAllReleases();
    const assets = latestRelease.assets;
    
    console.log(`最新版本: ${latestRelease.tag_name}`);
    console.log(`发布时间: ${new Date(latestRelease.published_at).toLocaleString()}`);
    console.log(`包含 ${assets.length} 个文件`);
    
    if (!silentInstallation) {
      console.log('\n可用版本:');
      assets.forEach((asset, i) => {
        console.log(`${i + 1}. ${asset.name} (${formatBytes(asset.size)})`);
      });
    }
    
    // 自动选择适合的版本
    const { asset: selectedAsset } = selectReleaseForSystem(assets);
    const fileName = selectedAsset.name;
    const fileSize = selectedAsset.size;
    
    console.log(`\n选择下载: ${fileName} (${formatBytes(fileSize)})`);
    
    // 获取下载代理
    const downloadProxy = await getWorkingProxyForDownload();
    
    // 处理下载URL
    let downloadUrl = selectedAsset.browser_download_url;
    
    // 处理GitHub重定向 - 参考Python代码逻辑
    try {
      const headResponse = await axios.head(downloadUrl, { headers });
      if (headResponse.headers.location) {
        downloadUrl = headResponse.headers.location;
        console.log('检测到GitHub重定向');
      }
    } catch (error) {
      if (error.response && error.response.headers.location) {
        downloadUrl = error.response.headers.location;
        console.log('检测到GitHub重定向');
      }
    }
    
    // 如果使用代理，添加代理前缀
    if (downloadProxy) {
      downloadUrl = `${downloadProxy}${downloadUrl}`;
      console.log(`使用代理下载: ${downloadProxy}`);
    } else {
      console.log('使用直连下载');
    }
    
    const zipPath = path.join(workPath, fileName);
    
    console.log('\n开始下载...');
    
    // 下载文件 - 增加重试次数
    let success = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await downloadWithProgress(downloadUrl, zipPath, 3, silentInstallation);
        success = true;
        break;
      } catch (error) {
        console.log(`下载失败 (尝试 ${attempt + 1}/3): ${error.message}`);
        if (attempt < 2) {
          console.log('正在重新下载...');
          // 清理失败的文件
          try {
            if (fs.existsSync(zipPath)) {
              fs.unlinkSync(zipPath);
            }
          } catch (e) {}
        }
      }
    }
    
    if (!success) {
      throw new Error('下载失败，已达最大重试次数');
    }
    
    if (!silentInstallation) {
      console.log('\n正在智能解压文件...');
    }
    
    // 智能解压文件 - 避免深层嵌套路径
    try {
      extractZipSmart(zipPath, targetDir);
      console.log('✅ 智能解压完成，已优化目录结构');
    } catch (error) {
      console.log('智能解压失败，使用传统解压方式...');
      // 降级到传统解压方式
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(targetDir, true);
      
      // 在Linux/macOS上设置执行权限
      if (os.platform() !== 'win32') {
        const executablePath = path.join(targetDir, 'Lagrange.OneBot');
        if (fs.existsSync(executablePath)) {
          fs.chmodSync(executablePath, '755');
          console.log('已设置执行权限');
        }
      }
    }
    
    // 清理下载的压缩包
    try {
      fs.unlinkSync(zipPath);
    } catch (error) {
      console.log(`清理压缩包失败: ${error.message}`);
    }
    
    console.log('\n✅ Lagrange.OneBot 下载安装完成!');
    console.log(`安装目录: ${targetDir}`);
    
    // 显示可执行文件路径信息
    const platform = os.platform();
    const executableName = platform === 'win32' ? 'Lagrange.OneBot.exe' : 'Lagrange.OneBot';
    const executablePath = path.join(targetDir, executableName);
    
    if (fs.existsSync(executablePath)) {
      console.log(`可执行文件: ${executablePath}`);
      if (targetDir === workPath) {
        console.log(`相对路径: ./${executableName}`);
        console.log('✅ 可执行文件已安装到根目录，配置文件中可使用相对路径！');
      }
    }
    
    return targetDir;
    
  } catch (error) {
    console.error(`\n❌ 下载失败: ${error.message}`);
    throw error;
  }
}

// 检查是否已安装Lagrange - 修改：在根目录中查找
function checkLagrangeInstalled() {
  const platform = os.platform();
  let executableName;
  
  if (platform === 'win32') {
    executableName = 'Lagrange.OneBot.exe';
  } else {
    executableName = 'Lagrange.OneBot';
  }
  
  // 修改：在根目录中查找，而不是OneBot子目录
  const executablePath = path.join(workPath, executableName);
  return fs.existsSync(executablePath);
}

// 获取可执行文件路径 - 修改：返回根目录中的路径
function getExecutablePath() {
  const platform = os.platform();
  let executableName;
  
  if (platform === 'win32') {
    executableName = 'Lagrange.OneBot.exe';
  } else {
    executableName = 'Lagrange.OneBot';
  }
  
  // 修改：返回根目录中的路径
  return path.join(workPath, executableName);
}

// 获取已安装版本信息 - 修改：使用根目录路径
function getInstalledVersion() {
  const executablePath = getExecutablePath();
  
  if (!fs.existsSync(executablePath)) {
    return null;
  }
  
  try {
    const stats = fs.statSync(executablePath);
    return {
      path: executablePath,
      size: stats.size,
      modified: stats.mtime
    };
  } catch (error) {
    return null;
  }
}

// 主函数 - 修改：默认安装到根目录
async function main() {
  program
    .option('-s, --silent', '静默安装（无进度显示，使用默认设置）')
    .option('-o, --output <path>', '设置安装目录路径')
    .parse(process.argv);

  const options = program.opts();
  
  const silentInstallation = options.silent || false;
  const outputPath = options.output || workPath; // 修改：默认使用根目录
  
  try {
    if (!silentInstallation) {
      console.log("=== Lagrange.OneBot 下载器 ===");
      console.log(`工作目录: ${workPath}`);
      console.log(`安装目录: ${outputPath}`);
      console.log(`系统信息: ${os.platform()} ${os.arch()}`);
      
      // 检查已安装版本
      const installed = getInstalledVersion();
      if (installed) {
        console.log(`检测到已安装版本:`);
        console.log(`  路径: ${installed.path}`);
        console.log(`  大小: ${formatBytes(installed.size)}`);
        console.log(`  修改时间: ${installed.modified.toLocaleString()}`);
      }
    }
    
    await downloadLagrange(silentInstallation, outputPath);
    
    if (!silentInstallation) {
      console.log('\n🎉 安装完成! 可以开始使用 Lagrange.OneBot 了');
      console.log('📋 配置文件中可以使用相对路径: "./Lagrange.OneBot.exe"');
    }
    
  } catch (error) {
    console.error(`\n💥 安装失败: ${error.message}`);
    process.exit(1);
  }
}

// 导出函数供其他模块使用
module.exports = {
  downloadLagrange,
  checkLagrangeInstalled,
  getExecutablePath,
  getInstalledVersion,
  getWorkingProxyForDownload,
  askProxyPreference,
  main
};

// 如果直接运行此文件
if (require.main === module) {
  main().catch(error => {
    console.error(`错误: ${error.message}`);
    process.exit(1);
  });
}
