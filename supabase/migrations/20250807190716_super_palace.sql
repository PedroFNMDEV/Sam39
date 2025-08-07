/*
  # Adicionar campo bitrate_original na tabela playlists_videos

  1. Alterações na Tabela
    - `playlists_videos`
      - Adicionar coluna `bitrate_original` (INT) para armazenar o bitrate original do arquivo
      - Adicionar índice para melhor performance nas consultas

  2. Dados
    - Atualizar registros existentes com bitrate_video como bitrate_original
    - Definir valor padrão 0 para registros sem bitrate

  3. Observações
    - Campo será usado para mostrar o bitrate real do arquivo original
    - Diferente do bitrate_video que pode ser alterado após conversão
*/

-- Adicionar coluna bitrate_original se não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'playlists_videos' AND column_name = 'bitrate_original'
  ) THEN
    ALTER TABLE playlists_videos ADD COLUMN bitrate_original INT DEFAULT 0;
  END IF;
END $$;

-- Atualizar registros existentes que não têm bitrate_original
UPDATE playlists_videos 
SET bitrate_original = COALESCE(bitrate_video, 0) 
WHERE bitrate_original IS NULL OR bitrate_original = 0;

-- Adicionar índice para melhor performance
CREATE INDEX IF NOT EXISTS idx_playlists_videos_bitrate_original 
ON playlists_videos(bitrate_original);

-- Adicionar comentário na coluna
ALTER TABLE playlists_videos 
MODIFY COLUMN bitrate_original INT DEFAULT 0 
COMMENT 'Bitrate original do arquivo de vídeo em kbps';