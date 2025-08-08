const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');
const SSHManager = require('../config/SSHManager');
const wowzaService = require('../config/WowzaStreamingService');

const router = express.Router();

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const tempDir = '/tmp/video-uploads';
      await fs.mkdir(tempDir, { recursive: true });
      cb(null, tempDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const sanitizedName = file.originalname
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .replace(/_{2,}/g, '_');
    cb(null, `${Date.now()}_${sanitizedName}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    // Lista expandida de tipos MIME para vídeos
    const allowedTypes = [
      'video/mp4', 'video/avi', 'video/quicktime', 'video/x-msvideo', 
      'video/wmv', 'video/x-ms-wmv', 'video/flv', 'video/x-flv',
      'video/webm', 'video/mkv', 'video/x-matroska', 'video/3gpp',
      'video/3gpp2', 'video/mp2t', 'video/mpeg', 'video/ogg',
      'application/octet-stream' // Para arquivos que podem não ter MIME correto
    ];
    
    // Verificar também por extensão para todos os formatos
    const fileName = file.originalname.toLowerCase();
    const hasValidExtension = [
      '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv', 
      '.3gp', '.3g2', '.ts', '.mpg', '.mpeg', '.ogv', '.m4v', '.asf'
    ].some(ext => 
      fileName.endsWith(ext)
    );
    
    if (allowedTypes.includes(file.mimetype) || hasValidExtension) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de arquivo não suportado: ${file.mimetype}. Extensões aceitas: .mp4, .avi, .mov, .wmv, .flv, .webm, .mkv, .3gp, .ts, .mpg, .ogv, .m4v`), false);
    }
  }
});

router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const folderId = req.query.folder_id;
    if (!folderId) {
      return res.status(400).json({ error: 'folder_id é obrigatório' });
    }

    const [folderRows] = await db.execute(
      'SELECT identificacao FROM streamings WHERE codigo = ? AND codigo_cliente = ?',
      [folderId, userId]
    );
    if (folderRows.length === 0) {
      return res.status(404).json({ error: 'Pasta não encontrada' });
    }

    const folderName = folderRows[0].identificacao;
    const userLogin = req.user.email.split('@')[0];
    const folderPath = `/${userLogin}/${folderName}/`;

    const [rows] = await db.execute(
      `SELECT 
        codigo as id,
        video as nome,
        path_video as url,
        duracao_segundos as duracao,
        tamanho_arquivo as tamanho,
        bitrate_video,
        bitrate_original,
        formato_original,
        status_conversao
       FROM playlists_videos 
       WHERE path_video LIKE ?
       ORDER BY codigo`,
      [`%${folderPath}%`]
    );

    console.log(`📁 Buscando vídeos na pasta: ${folderPath}`);
    console.log(`📊 Encontrados ${rows.length} vídeos no banco`);

    const videos = rows.map(video => {
      // Construir URL correta baseada no caminho do banco
      let url = video.url;
      
      // Se o path_video já contém o caminho completo do servidor, extrair apenas a parte relativa
      if (url.includes('/usr/local/WowzaStreamingEngine/content/')) {
        const relativePath = url.replace('/usr/local/WowzaStreamingEngine/content/', '');
        url = relativePath;
      } else if (url.startsWith('/')) {
        url = url.substring(1); // Remove barra inicial
      }
      
      console.log(`🎥 Vídeo: ${video.nome} -> URL: ${url}`);
      
      // Determinar se precisa de conversão
      const isMP4 = video.formato_original === 'mp4' || video.nome.toLowerCase().endsWith('.mp4');
      const needsConversion = !isMP4 || video.status_conversao === 'pendente';
      
      return {
        id: video.id,
        nome: video.nome,
        url,
        duracao: video.duracao,
        tamanho: video.tamanho,
        bitrate_video: video.bitrate_video || 0,
        bitrate_original: video.bitrate_original || 0,
        formato_original: video.formato_original || 'unknown',
        status_conversao: video.status_conversao,
        needs_conversion: needsConversion,
        is_mp4: isMP4,
        folder: folderName,
        user: userLogin
      };
    });

    console.log(`✅ Retornando ${videos.length} vídeos processados`);
    res.json(videos);
  } catch (err) {
    console.error('Erro ao buscar vídeos:', err);
    res.status(500).json({ error: 'Erro ao buscar vídeos', details: err.message });
  }
});

router.post('/upload', authMiddleware, upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const userId = req.user.id;
    const userLogin = req.user.email.split('@')[0];
    const folderId = req.query.folder_id || 'default';
    
    console.log(`📤 Upload iniciado - Usuário: ${userLogin}, Pasta: ${folderId}, Arquivo: ${req.file.originalname}`);
    console.log(`📋 Tipo MIME: ${req.file.mimetype}, Tamanho: ${req.file.size} bytes`);
    
    // Verificar se é um formato de vídeo válido
    const videoExtensions = [
      '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv',
      '.3gp', '.3g2', '.ts', '.mpg', '.mpeg', '.ogv', '.m4v', '.asf'
    ];
    const fileExtension = path.extname(req.file.originalname).toLowerCase();
    
    if (!videoExtensions.includes(fileExtension)) {
      console.log(`❌ Extensão não suportada: ${fileExtension}`);
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ 
        error: `Formato de arquivo não suportado: ${fileExtension}`,
        details: `Formatos aceitos: ${videoExtensions.join(', ')}`
      });
    }
    
    const duracao = parseInt(req.body.duracao) || 0;
    const tamanho = parseInt(req.body.tamanho) || req.file.size;

    const [userRows] = await db.execute(
      `SELECT 
        s.codigo_servidor, s.identificacao as folder_name,
        s.espaco, s.espaco_usado
       FROM streamings s 
       WHERE s.codigo = ? AND s.codigo_cliente = ?`,
      [folderId, userId]
    );
    if (userRows.length === 0) {
      console.log(`❌ Pasta ${folderId} não encontrada para usuário ${userId}`);
      return res.status(404).json({ error: 'Pasta não encontrada' });
    }

    const userData = userRows[0];
    const serverId = userData.codigo_servidor || 1;
    const folderName = userData.folder_name;
    
    console.log(`📁 Pasta encontrada: ${folderName}, Servidor: ${serverId}`);

    const spaceMB = Math.ceil(tamanho / (1024 * 1024));
    const availableSpace = userData.espaco - userData.espaco_usado;

    if (spaceMB > availableSpace) {
      console.log(`❌ Espaço insuficiente: ${spaceMB}MB necessário, ${availableSpace}MB disponível`);
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ 
        error: `Espaço insuficiente. Necessário: ${spaceMB}MB, Disponível: ${availableSpace}MB`,
        details: `Seu plano permite ${userData.espaco}MB de armazenamento. Atualmente você está usando ${userData.espaco_usado}MB. Para enviar este arquivo, você precisa de mais ${spaceMB - availableSpace}MB livres.`,
        spaceInfo: {
          required: spaceMB,
          available: availableSpace,
          total: userData.espaco,
          used: userData.espaco_usado,
          percentage: Math.round((userData.espaco_usado / userData.espaco) * 100)
        }
      });
    }

    await SSHManager.createUserDirectory(serverId, userLogin);
    await SSHManager.createUserFolder(serverId, userLogin, folderName);

    const remotePath = `/usr/local/WowzaStreamingEngine/content/${userLogin}/${folderName}/${req.file.filename}`;
    await SSHManager.uploadFile(serverId, req.file.path, remotePath);
    await fs.unlink(req.file.path);

    console.log(`✅ Arquivo enviado para: ${remotePath}`);

    // Obter informações do vídeo usando ffprobe
    let videoBitrate = 0;
    let videoDuration = duracao;
    let videoWidth = 1920;
    let videoHeight = 1080;
    
    try {
      const probeCommand = `ffprobe -v quiet -print_format json -show_format -show_streams "${remotePath}" 2>/dev/null || echo "NO_PROBE"`;
      const probeResult = await SSHManager.executeCommand(serverId, probeCommand);
      
      if (!probeResult.stdout.includes('NO_PROBE')) {
        const probeData = JSON.parse(probeResult.stdout);
        
        if (probeData.format) {
          videoDuration = Math.floor(parseFloat(probeData.format.duration) || duracao);
          videoBitrate = Math.floor(parseInt(probeData.format.bit_rate) / 1000) || 0;
        }
        
        if (probeData.streams) {
          const videoStream = probeData.streams.find(s => s.codec_type === 'video');
          if (videoStream) {
            videoWidth = videoStream.width || 1920;
            videoHeight = videoStream.height || 1080;
          }
        }
      }
    } catch (probeError) {
      console.warn('Erro ao obter informações do vídeo:', probeError.message);
    }

    // Construir caminho relativo para salvar no banco
    const relativePath = `${userLogin}/${folderName}/${req.file.filename}`;
    console.log(`💾 Salvando no banco com path: ${relativePath}`);

    // Nome do vídeo para salvar no banco
    const videoTitle = req.file.originalname;

    // Determinar se precisa de conversão
    const isMP4 = fileExtension === '.mp4';
    const needsConversion = !isMP4;
    const conversionStatus = needsConversion ? 'pendente' : null;

    const [result] = await db.execute(
      `INSERT INTO playlists_videos (
        codigo_playlist, path_video, video, width, height,
        bitrate, duracao, duracao_segundos, tipo, ordem, tamanho_arquivo,
        bitrate_video, bitrate_original, formato_original, status_conversao
      ) VALUES (0, ?, ?, ?, ?, 2500, ?, ?, 'video', 0, ?, ?, ?, ?, ?)`,
      [
        relativePath, videoTitle, videoWidth, videoHeight, 
        formatDuration(videoDuration), videoDuration, tamanho,
        videoBitrate, videoBitrate, fileExtension.substring(1), conversionStatus
      ]
    );

    await db.execute(
      'UPDATE streamings SET espaco_usado = espaco_usado + ? WHERE codigo = ?',
      [spaceMB, folderId]
    );

    console.log(`✅ Vídeo salvo no banco com ID: ${result.insertId}`);


    res.status(201).json({
      id: result.insertId,
      nome: videoTitle,
      url: relativePath,
      path: remotePath,
      bitrate_original: videoBitrate,
      formato_original: fileExtension.substring(1),
      needs_conversion: needsConversion,
      status_conversao: conversionStatus,
      duracao,
      tamanho,
      message: needsConversion ? 
        `Vídeo enviado! ⚠️ Este vídeo precisa ser convertido para MP4 antes de ser usado.` :
        `Vídeo MP4 enviado e pronto para uso!`
    });
  } catch (err) {
    console.error('Erro no upload:', err);
    if (req.file?.path) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    res.status(500).json({ error: 'Erro no upload do vídeo', details: err.message });
  }
});

// Função auxiliar para formatar duração
function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// Rota para testar acesso a vídeos
router.get('/test/:userId/:folder/:filename', authMiddleware, async (req, res) => {
  try {
    const { userId, folder, filename } = req.params;
    const userLogin = req.user.email.split('@')[0];
    
    // Verificar se arquivo existe no servidor via SSH
    const [serverRows] = await db.execute(
      'SELECT codigo_servidor FROM streamings WHERE codigo_cliente = ? LIMIT 1',
      [userId]
    );
    
    const serverId = serverRows.length > 0 ? serverRows[0].codigo_servidor : 1;
    const remotePath = `/usr/local/WowzaStreamingEngine/content/${userLogin}/${folder}/${filename}`;
    
    try {
      const fileInfo = await SSHManager.getFileInfo(serverId, remotePath);
      
      if (fileInfo.exists) {
        res.json({
          success: true,
          exists: true,
          path: remotePath,
          info: fileInfo,
          url: `/content/${userLogin}/${folder}/${filename}`
        });
      } else {
        res.json({
          success: false,
        url: `/content${relativePath}`,
          error: 'Arquivo não encontrado no servidor'
        });
      }
    } catch (sshError) {
      res.status(500).json({
        success: false,
        error: 'Erro ao verificar arquivo no servidor',
        details: sshError.message
      });
    }
  } catch (err) {
    console.error('Erro no teste de vídeo:', err);
    res.status(500).json({ error: 'Erro no teste de vídeo', details: err.message });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const videoId = req.params.id;
    const userId = req.user.id;
    const userLogin = req.user.email.split('@')[0];

    const [videoRows] = await db.execute(
      'SELECT path_video, video, tamanho_arquivo FROM playlists_videos WHERE codigo = ?',
      [videoId]
    );
    if (videoRows.length === 0) {
      return res.status(404).json({ error: 'Vídeo não encontrado' });
    }

    const video = videoRows[0];

    if (!video.path_video.includes(`/${userLogin}/`)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const [serverRows] = await db.execute(
      `SELECT s.codigo_servidor 
       FROM streamings s 
       WHERE s.codigo_cliente = ? 
       LIMIT 1`,
      [userId]
    );

    const serverId = serverRows.length > 0 ? serverRows[0].codigo_servidor : 1;

    // Obter informações do arquivo antes de deletar
    let fileSize = video.tamanho_arquivo || 0;
    try {
      const remotePath = `/usr/local/WowzaStreamingEngine/content${video.path_video}`;
      
      // Verificar tamanho real do arquivo se não estiver no banco
      if (!fileSize) {
        const fileInfo = await SSHManager.getFileInfo(serverId, remotePath);
        fileSize = fileInfo.exists ? fileInfo.size : 0;
      }
      
      await SSHManager.deleteFile(serverId, remotePath);
      console.log(`✅ Arquivo removido do servidor: ${remotePath}`);
    } catch (fileError) {
      console.warn('Erro ao remover arquivo físico:', fileError.message);
    }

    // Atualizar espaço usado baseado no tamanho real
    if (fileSize > 0) {
      const spaceMB = Math.ceil(fileSize / (1024 * 1024));
          bitrate, duracao, duracao_segundos, tipo, ordem, tamanho_arquivo,
          bitrate_original, formato_original
        ) VALUES (0, ?, ?, 1920, 1080, 2500, ?, ?, 'video', 0, ?, ?, ?)`,
        [relativePath, videoTitle, formatDuration(duracao), duracao, tamanho, 0, fileExtension.substring(1)]
      );
      console.log(`📊 Espaço liberado: ${spaceMB}MB`);
    }

    await db.execute(
      'DELETE FROM playlists_videos WHERE codigo = ?',
      [videoId]
    );

    res.json({ success: true, message: 'Vídeo removido com sucesso' });
  } catch (err) {
    console.error('Erro ao remover vídeo:', err);
    res.status(500).json({ error: 'Erro ao remover vídeo', details: err.message });
  }
});

module.exports = router;