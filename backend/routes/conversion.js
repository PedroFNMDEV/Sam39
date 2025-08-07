const express = require('express');
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');
const SSHManager = require('../config/SSHManager');
const path = require('path');

const router = express.Router();

// GET /api/conversion/videos - Lista vídeos que precisam de conversão
router.get('/videos', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const userLogin = req.user.email ? req.user.email.split('@')[0] : `user_${userId}`;
    const { folder_id } = req.query;

    let whereClause = 'WHERE path_video LIKE ?';
    const params = [`%/${userLogin}/%`];

    if (folder_id) {
      // Buscar nome da pasta
      const [folderRows] = await db.execute(
        'SELECT identificacao FROM streamings WHERE codigo = ? AND codigo_cliente = ?',
        [folder_id, userId]
      );

      if (folderRows.length > 0) {
        const folderName = folderRows[0].identificacao;
        whereClause += ' AND path_video LIKE ?';
        params.push(`%/${userLogin}/${folderName}/%`);
      }
    }

    const [rows] = await db.execute(
      `SELECT 
        codigo as id,
        video as nome,
        path_video as url,
        duracao_segundos as duracao,
        tamanho_arquivo as tamanho,
        bitrate_video,
        formato_original,
        status_conversao,
        path_video_mp4,
        data_conversao
       FROM playlists_videos 
       ${whereClause}
       ORDER BY codigo DESC`,
      params
    );

    // Processar vídeos para identificar quais precisam de conversão
    const videos = rows.map(video => {
      const fileName = path.basename(video.url);
      const fileExtension = path.extname(fileName).toLowerCase();
      const isMP4 = fileExtension === '.mp4';
      const needsConversion = !isMP4 || (video.bitrate_video && video.bitrate_video > (user?.bitrate || 2500));
      
      return {
        ...video,
        formato_original: video.formato_original || fileExtension.substring(1),
        is_mp4: isMP4,
        needs_conversion: needsConversion,
        can_use: !needsConversion || video.status_conversao === 'concluida',
        bitrate_exceeds_limit: video.bitrate_video && video.bitrate_video > (user?.bitrate || 2500),
        user_bitrate_limit: user?.bitrate || 2500
      };
    });

    res.json({
      success: true,
      videos,
      user_limits: {
        bitrate: user?.bitrate || 2500,
        storage: user?.espaco || 1000
      }
    });
  } catch (error) {
    console.error('Erro ao listar vídeos para conversão:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao listar vídeos',
      details: error.message 
    });
  }
});

// POST /api/conversion/convert - Converter vídeo
router.post('/convert', authMiddleware, async (req, res) => {
  try {
    const { video_id, target_bitrate, target_resolution } = req.body;
    const userId = req.user.id;
    const userLogin = req.user.email ? req.user.email.split('@')[0] : `user_${userId}`;

    if (!video_id) {
      return res.status(400).json({ 
        success: false, 
        error: 'ID do vídeo é obrigatório' 
      });
    }

    // Validar bitrate
    const maxBitrate = req.user.bitrate || 2500;
    const finalBitrate = Math.min(target_bitrate || maxBitrate, maxBitrate);

    if (target_bitrate && target_bitrate > maxBitrate) {
      return res.status(400).json({
        success: false,
        error: `Bitrate solicitado (${target_bitrate} kbps) excede o limite do plano (${maxBitrate} kbps)`
      });
    }

    // Buscar vídeo
    const [videoRows] = await db.execute(
      'SELECT * FROM playlists_videos WHERE codigo = ?',
      [video_id]
    );

    if (videoRows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Vídeo não encontrado' 
      });
    }

    const video = videoRows[0];

    // Verificar se o vídeo pertence ao usuário
    if (!video.path_video.includes(`/${userLogin}/`)) {
      return res.status(403).json({ 
        success: false, 
        error: 'Acesso negado ao vídeo' 
      });
    }

    // Buscar servidor do usuário
    const [serverRows] = await db.execute(
      'SELECT codigo_servidor FROM streamings WHERE codigo_cliente = ? LIMIT 1',
      [userId]
    );

    const serverId = serverRows.length > 0 ? serverRows[0].codigo_servidor : 1;

    // Marcar como em conversão
    await db.execute(
      'UPDATE playlists_videos SET status_conversao = "em_andamento" WHERE codigo = ?',
      [video_id]
    );

    // Construir caminhos
    const inputPath = video.path_video.startsWith('/usr/local/WowzaStreamingEngine/content/') ? 
      video.path_video : `/usr/local/WowzaStreamingEngine/content${video.path_video}`;
    
    const fileName = path.basename(inputPath);
    const directory = path.dirname(inputPath);
    const nameWithoutExt = path.parse(fileName).name;
    const outputPath = path.join(directory, `${nameWithoutExt}_converted.mp4`);

    try {
      // Comando FFmpeg para conversão
      const resolution = target_resolution || '1920x1080';
      const ffmpegCommand = `ffmpeg -i "${inputPath}" -c:v libx264 -preset medium -crf 23 -b:v ${finalBitrate}k -maxrate ${finalBitrate}k -bufsize ${finalBitrate * 2}k -vf "scale=${resolution}" -c:a aac -b:a 128k -movflags +faststart "${outputPath}" -y 2>/dev/null && echo "CONVERSION_SUCCESS" || echo "CONVERSION_ERROR"`;
      
      console.log(`🔄 Iniciando conversão: ${fileName} -> ${finalBitrate} kbps`);
      
      const result = await SSHManager.executeCommand(serverId, ffmpegCommand);
      
      if (result.stdout.includes('CONVERSION_SUCCESS')) {
        // Obter informações do arquivo convertido
        const sizeCommand = `stat -c%s "${outputPath}" 2>/dev/null || echo "0"`;
        const sizeResult = await SSHManager.executeCommand(serverId, sizeCommand);
        const newSize = parseInt(sizeResult.stdout.trim()) || 0;

        // Obter duração e bitrate real do arquivo convertido
        const probeCommand = `ffprobe -v quiet -print_format json -show_format -show_streams "${outputPath}" 2>/dev/null || echo "NO_PROBE"`;
        const probeResult = await SSHManager.executeCommand(serverId, probeCommand);
        
        let realBitrate = finalBitrate;
        let realDuration = video.duracao_segundos || 0;
        
        if (!probeResult.stdout.includes('NO_PROBE')) {
          try {
            const probeData = JSON.parse(probeResult.stdout);
            if (probeData.format) {
              realDuration = Math.floor(parseFloat(probeData.format.duration) || 0);
              realBitrate = Math.floor(parseInt(probeData.format.bit_rate) / 1000) || finalBitrate;
            }
          } catch (parseError) {
            console.warn('Erro ao parsear dados do ffprobe:', parseError);
          }
        }

        // Atualizar banco de dados
        await db.execute(
          `UPDATE playlists_videos SET 
           status_conversao = "concluida",
           path_video_mp4 = ?,
           bitrate_video = ?,
           tamanho_arquivo_mp4 = ?,
           duracao_segundos = ?,
           data_conversao = NOW()
           WHERE codigo = ?`,
          [outputPath, realBitrate, newSize, realDuration, video_id]
        );

        console.log(`✅ Conversão concluída: ${fileName} -> ${realBitrate} kbps`);

        res.json({
          success: true,
          message: 'Vídeo convertido com sucesso!',
          converted_video: {
            id: video_id,
            path_mp4: outputPath,
            bitrate: realBitrate,
            size: newSize,
            duration: realDuration
          }
        });
      } else {
        throw new Error('Falha na conversão FFmpeg');
      }
    } catch (conversionError) {
      console.error('Erro na conversão:', conversionError);
      
      // Marcar como erro
      await db.execute(
        'UPDATE playlists_videos SET status_conversao = "erro" WHERE codigo = ?',
        [video_id]
      );

      res.status(500).json({
        success: false,
        error: 'Erro na conversão do vídeo',
        details: conversionError.message
      });
    }
  } catch (error) {
    console.error('Erro ao converter vídeo:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro interno do servidor',
      details: error.message 
    });
  }
});

// GET /api/conversion/status/:video_id - Status da conversão
router.get('/status/:video_id', authMiddleware, async (req, res) => {
  try {
    const { video_id } = req.params;
    const userId = req.user.id;
    const userLogin = req.user.email ? req.user.email.split('@')[0] : `user_${userId}`;

    const [rows] = await db.execute(
      `SELECT 
        codigo as id,
        video as nome,
        status_conversao,
        bitrate_video,
        path_video_mp4,
        data_conversao,
        formato_original
       FROM playlists_videos 
       WHERE codigo = ? AND path_video LIKE ?`,
      [video_id, `%/${userLogin}/%`]
    );

    if (rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Vídeo não encontrado' 
      });
    }

    const video = rows[0];
    
    res.json({
      success: true,
      conversion_status: {
        id: video.id,
        nome: video.nome,
        status: video.status_conversao || 'nao_iniciada',
        bitrate: video.bitrate_video,
        mp4_path: video.path_video_mp4,
        converted_at: video.data_conversao,
        original_format: video.formato_original
      }
    });
  } catch (error) {
    console.error('Erro ao verificar status da conversão:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao verificar status',
      details: error.message 
    });
  }
});

// DELETE /api/conversion/:video_id - Remover vídeo convertido
router.delete('/:video_id', authMiddleware, async (req, res) => {
  try {
    const { video_id } = req.params;
    const userId = req.user.id;
    const userLogin = req.user.email ? req.user.email.split('@')[0] : `user_${userId}`;

    // Buscar vídeo
    const [videoRows] = await db.execute(
      'SELECT path_video_mp4 FROM playlists_videos WHERE codigo = ? AND path_video LIKE ?',
      [video_id, `%/${userLogin}/%`]
    );

    if (videoRows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Vídeo não encontrado' 
      });
    }

    const video = videoRows[0];

    if (video.path_video_mp4) {
      // Buscar servidor do usuário
      const [serverRows] = await db.execute(
        'SELECT codigo_servidor FROM streamings WHERE codigo_cliente = ? LIMIT 1',
        [userId]
      );

      const serverId = serverRows.length > 0 ? serverRows[0].codigo_servidor : 1;

      // Remover arquivo MP4 convertido do servidor
      try {
        await SSHManager.deleteFile(serverId, video.path_video_mp4);
        console.log(`✅ Arquivo MP4 convertido removido: ${video.path_video_mp4}`);
      } catch (fileError) {
        console.warn('Erro ao remover arquivo MP4:', fileError.message);
      }
    }

    // Limpar dados de conversão no banco
    await db.execute(
      `UPDATE playlists_videos SET 
       status_conversao = NULL,
       path_video_mp4 = NULL,
       bitrate_video = NULL,
       tamanho_arquivo_mp4 = NULL,
       data_conversao = NULL
       WHERE codigo = ?`,
      [video_id]
    );

    res.json({
      success: true,
      message: 'Conversão removida com sucesso'
    });
  } catch (error) {
    console.error('Erro ao remover conversão:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao remover conversão',
      details: error.message 
    });
  }
});

module.exports = router;