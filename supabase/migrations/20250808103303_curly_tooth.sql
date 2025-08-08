/*
  # Adicionar campos de bitrate e conversão na tabela playlists_videos

  1. Alterações na Tabela
    - `playlists_videos`
      - Adicionar coluna `bitrate_original` (INT) para armazenar o bitrate original do arquivo
      - Adicionar coluna `formato_original` (VARCHAR) para armazenar o formato original
      - Adicionar coluna `status_conversao` (ENUM) para controlar o status de conversão
      - Adicionar coluna `path_video_mp4` (TEXT) para caminho do arquivo MP4 convertido
      - Adicionar coluna `data_conversao` (TIMESTAMP) para data da conversão

  2. Índices
    - Adicionar índices para melhor performance nas consultas

  3. Dados
    - Atualizar registros existentes com valores padrão
*/

-- Adicionar coluna bitrate_original se não existir
ALTER TABLE playlists_videos 
ADD COLUMN IF NOT EXISTS bitrate_original INT DEFAULT 0 
COMMENT 'Bitrate original do arquivo de vídeo em kbps';

-- Adicionar coluna formato_original se não existir
ALTER TABLE playlists_videos 
ADD COLUMN IF NOT EXISTS formato_original VARCHAR(10) DEFAULT 'mp4' 
COMMENT 'Formato original do arquivo (mp4, avi, mov, etc)';

-- Adicionar coluna status_conversao se não existir
ALTER TABLE playlists_videos 
ADD COLUMN IF NOT EXISTS status_conversao ENUM('pendente', 'em_andamento', 'concluida', 'erro') DEFAULT NULL 
COMMENT 'Status da conversão do vídeo';

-- Adicionar coluna path_video_mp4 se não existir
ALTER TABLE playlists_videos 
ADD COLUMN IF NOT EXISTS path_video_mp4 TEXT DEFAULT NULL 
COMMENT 'Caminho do arquivo MP4 convertido';

-- Adicionar coluna data_conversao se não existir
ALTER TABLE playlists_videos 
ADD COLUMN IF NOT EXISTS data_conversao TIMESTAMP NULL DEFAULT NULL 
COMMENT 'Data e hora da conversão';

-- Atualizar registros existentes que não têm bitrate_original
UPDATE playlists_videos 
SET bitrate_original = COALESCE(bitrate_video, 0) 
WHERE bitrate_original IS NULL OR bitrate_original = 0;

-- Atualizar formato_original baseado no nome do arquivo para registros existentes
UPDATE playlists_videos 
SET formato_original = CASE 
  WHEN video LIKE '%.mp4' THEN 'mp4'
  WHEN video LIKE '%.avi' THEN 'avi'
  WHEN video LIKE '%.mov' THEN 'mov'
  WHEN video LIKE '%.wmv' THEN 'wmv'
  WHEN video LIKE '%.flv' THEN 'flv'
  WHEN video LIKE '%.webm' THEN 'webm'
  WHEN video LIKE '%.mkv' THEN 'mkv'
  WHEN video LIKE '%.3gp' THEN '3gp'
  WHEN video LIKE '%.ts' THEN 'ts'
  WHEN video LIKE '%.mpg' THEN 'mpg'
  WHEN video LIKE '%.mpeg' THEN 'mpeg'
  WHEN video LIKE '%.ogv' THEN 'ogv'
  WHEN video LIKE '%.m4v' THEN 'm4v'
  WHEN video LIKE '%.asf' THEN 'asf'
  ELSE 'mp4'
END
WHERE formato_original = 'mp4' OR formato_original IS NULL;

-- Marcar vídeos não-MP4 como pendentes de conversão
UPDATE playlists_videos 
SET status_conversao = 'pendente' 
WHERE formato_original != 'mp4' AND (status_conversao IS NULL OR status_conversao = '');

-- Adicionar índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_playlists_videos_bitrate_original 
ON playlists_videos(bitrate_original);

CREATE INDEX IF NOT EXISTS idx_playlists_videos_formato_original 
ON playlists_videos(formato_original);

CREATE INDEX IF NOT EXISTS idx_playlists_videos_status_conversao 
ON playlists_videos(status_conversao);

CREATE INDEX IF NOT EXISTS idx_playlists_videos_path_video_mp4 
ON playlists_videos(path_video_mp4);