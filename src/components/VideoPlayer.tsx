import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useStream } from '../context/StreamContext';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, X, SkipForward, SkipBack } from 'lucide-react';
import Hls from 'hls.js';

interface VideoPlayerProps {
  playlistVideo?: {
    id: number;
    nome: string;
    url: string;
    duracao?: number;
  };
  onVideoEnd?: () => void;
  className?: string;
  autoplay?: boolean;
  controls?: boolean;
  height?: string;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ 
  playlistVideo, 
  onVideoEnd, 
  className = "w-full",
  autoplay = false,
  controls = true,
  height = "h-96"
}) => {
  const { user } = useAuth();
  const { streamData } = useStream();
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  
  const [obsStreamActive, setObsStreamActive] = useState(false);
  const [obsStreamUrl, setObsStreamUrl] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const userLogin = user?.email?.split('@')[0] || `user_${user?.id || 'usuario'}`;

  useEffect(() => {
    checkOBSStream();
  }, []);

  const checkOBSStream = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) return;

      const response = await fetch('/api/streaming/obs-status', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.obs_stream.is_live) {
          setObsStreamActive(true);
          setObsStreamUrl(`http://samhost.wcore.com.br:1935/samhost/${userLogin}_live/playlist.m3u8`);
        } else {
          setObsStreamActive(false);
        }
      }
    } catch (error) {
      console.error('Erro ao verificar stream OBS:', error);
    }
  };
  
  // Função melhorada para construir URLs de vídeo
  const buildVideoUrl = (url: string) => {
    if (!url) return '';
    
    // Se já é uma URL completa, usar como está
    if (url.startsWith('http')) {
      return url;
    }
    
    // Para vídeos SSH, usar URL diretamente
    if (url.includes('/api/videos-ssh/')) {
      return url;
    }
    
    // Para caminhos relativos, construir URL correta
    const cleanPath = url.replace(/^\/+/, ''); // Remove barras iniciais
    const token = localStorage.getItem('auth_token');
    const baseUrl = `/content/${cleanPath}`;
    return token ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}auth_token=${encodeURIComponent(token)}` : baseUrl;
  };

  // Configurar fonte de vídeo
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Limpar HLS anterior se existir
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    setError(null);
    setLoading(true);

    let videoSrc = '';
    
    if (playlistVideo?.url) {
      videoSrc = buildVideoUrl(playlistVideo.url);
    } else if (streamData.isLive) {
      videoSrc = `http://samhost.wcore.com.br:1935/samhost/${userLogin}_live/playlist.m3u8`;
    } else if (obsStreamActive) {
      videoSrc = obsStreamUrl;
    }

    if (!videoSrc) {
      setLoading(false);
      return;
    }

    console.log('🎥 Configurando vídeo:', {
      original: playlistVideo?.url || 'stream',
      processed: videoSrc,
      isHLS: videoSrc.includes('.m3u8'),
      isSSH: videoSrc.includes('/api/videos-ssh/')
    });

    // Detectar se é HLS
    const isHLS = videoSrc.includes('.m3u8') || !playlistVideo;

    if (isHLS && Hls.isSupported()) {
      // Usar HLS.js para streams
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: !playlistVideo,
        backBufferLength: playlistVideo ? 30 : 10,
        maxBufferLength: playlistVideo ? 60 : 20,
        debug: false,
        xhrSetup: (xhr, url) => {
          xhr.withCredentials = false;
          const token = localStorage.getItem('auth_token');
          if (token && (url.includes('/content/') || url.includes('/api/videos-ssh/'))) {
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          }
          xhr.timeout = 15000;
        }
      });

      hls.loadSource(videoSrc);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('✅ Manifest HLS carregado');
        setLoading(false);
        if (autoplay) {
          setTimeout(() => {
            video.play().catch(error => {
              console.warn('Autoplay falhou:', error);
            });
          }, 100);
        }
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        console.error('HLS Error:', data);
        if (data.fatal) {
          setLoading(false);
          let errorMsg = 'Erro ao carregar stream';
          
          if (data.details?.includes('404')) {
            errorMsg = 'Vídeo não encontrado. Verifique se o arquivo existe no servidor.';
          } else if (data.details?.includes('401')) {
            errorMsg = 'Erro de autenticação. Faça login novamente.';
          } else if (data.details?.includes('timeout')) {
            errorMsg = 'Timeout no carregamento. Tente novamente.';
          }
          
          setError(errorMsg);
        }
      });

      hlsRef.current = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl') && isHLS) {
      // Safari nativo para HLS
      console.log('🍎 Usando Safari nativo para HLS');
      video.src = videoSrc;
      setLoading(false);
      if (autoplay) {
        setTimeout(() => {
          video.play().catch(error => {
            console.warn('Autoplay falhou:', error);
          });
        }, 100);
      }
    } else {
      // Vídeo regular (MP4, etc.)
      console.log('📹 Carregando vídeo MP4');
      video.src = videoSrc;
      video.load();
      setLoading(false);
      
      if (autoplay) {
        setTimeout(() => {
          video.play().catch(error => {
            console.warn('Autoplay falhou:', error);
          });
        }, 100);
      }
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [playlistVideo, streamData.isLive, obsStreamActive, obsStreamUrl, autoplay]);

  // Event handlers
  const handlePlay = () => setIsPlaying(true);
  const handlePause = () => setIsPlaying(false);
  const handleEnded = () => {
    setIsPlaying(false);
    if (onVideoEnd) onVideoEnd();
  };
  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    setCurrentTime(video.currentTime);
  };
  const handleDurationChange = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    setDuration(video.duration);
  };
  const handleVolumeChange = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    setVolume(video.volume);
    setIsMuted(video.muted);
  };
  const handleError = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    console.error('Erro no vídeo:', video.error);
    setLoading(false);
    
    let errorMsg = 'Erro ao carregar vídeo';
    if (video.error) {
      switch (video.error.code) {
        case 1:
          errorMsg = 'Reprodução abortada';
          break;
        case 2:
          errorMsg = 'Erro de rede ao carregar vídeo';
          break;
        case 3:
          errorMsg = 'Erro ao decodificar vídeo';
          break;
        case 4:
          errorMsg = 'Formato de vídeo não suportado';
          break;
        default:
          errorMsg = `Erro ${video.error.code}: ${video.error.message}`;
      }
    }
    setError(errorMsg);
  };

  const handleLoadStart = () => {
    setLoading(true);
    setError(null);
  };

  const handleCanPlay = () => {
    setLoading(false);
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
    } else {
      video.play().catch(console.error);
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video || (!playlistVideo && streamData.isLive)) return;

    const newTime = parseFloat(e.target.value);
    video.currentTime = newTime;
  };

  const handleVolumeSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;

    const newVolume = parseFloat(e.target.value);
    video.volume = newVolume;
    video.muted = newVolume === 0;
  };

  const toggleFullscreen = () => {
    const container = document.querySelector('.video-container');
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(console.error);
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(console.error);
      setIsFullscreen(false);
    }
  };

  const formatTime = (time: number): string => {
    if (!isFinite(time)) return '0:00';

    const hours = Math.floor(time / 3600);
    const minutes = Math.floor((time % 3600) / 60);
    const seconds = Math.floor(time % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const videoTitle = playlistVideo?.nome || 
    (streamData.isLive ? streamData.title || 'Transmissão ao Vivo' : 
     obsStreamActive ? 'Transmissão OBS ao Vivo' : undefined);

  const isLive = !playlistVideo && (streamData.isLive || obsStreamActive);

  return (
    <div className={`video-container relative bg-black rounded-lg overflow-hidden ${className} ${height}`}>
      {/* Player HTML5 */}
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        controls={false}
        muted={isMuted}
        preload="metadata"
        onPlay={handlePlay}
        onPause={handlePause}
        onEnded={handleEnded}
        onTimeUpdate={handleTimeUpdate}
        onDurationChange={handleDurationChange}
        onVolumeChange={handleVolumeChange}
        onError={handleError}
        onLoadStart={handleLoadStart}
        onCanPlay={handleCanPlay}
        crossOrigin="anonymous"
        playsInline
      />

      {/* Loading indicator */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-30 bg-black bg-opacity-50">
          <div className="flex flex-col items-center space-y-2">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
            <span className="text-white text-sm">Carregando...</span>
          </div>
        </div>
      )}

      {/* Indicador de transmissão ao vivo */}
      {isLive && (
        <div className="absolute top-4 left-4 z-20">
          <div className="bg-red-600 text-white px-3 py-1 rounded-full flex items-center space-x-2 text-sm font-medium">
            <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
            <span>AO VIVO</span>
          </div>
        </div>
      )}

      {/* Título do vídeo */}
      {videoTitle && (
        <div className="absolute top-4 right-4 z-20 bg-black bg-opacity-60 text-white px-3 py-1 rounded-md text-sm">
          {videoTitle}
        </div>
      )}

      {/* Erro */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center z-30 bg-black bg-opacity-75">
          <div className="text-white text-center p-6">
            <h3 className="text-lg font-semibold mb-2">Erro de Reprodução</h3>
            <p className="text-sm text-gray-300 mb-4">{error}</p>
            <button
              onClick={() => {
                setError(null);
                const video = videoRef.current;
                if (video) {
                  video.load();
                }
              }}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              Tentar Novamente
            </button>
          </div>
        </div>
      )}

      {/* Placeholder quando não há vídeo */}
      {!playlistVideo && !streamData.isLive && !obsStreamActive && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900 text-white">
          <Play className="h-16 w-16 mb-4 text-gray-400" />
          <h3 className="text-xl font-semibold mb-2">Nenhum vídeo carregado</h3>
          <p className="text-gray-400 text-center max-w-md">
            Selecione um vídeo ou inicie uma transmissão para visualizar o conteúdo aqui
          </p>
        </div>
      )}

      {/* Controles customizados */}
      {controls && (
        <div
          className={`absolute inset-0 bg-gradient-to-t from-black/70 to-transparent transition-opacity duration-300 ${
            showControls ? 'opacity-100' : 'opacity-0'
          }`}
          onMouseEnter={() => setShowControls(true)}
          onMouseLeave={() => {
            if (isPlaying) {
              setTimeout(() => setShowControls(false), 2000);
            }
          }}
        >
          {/* Botão de play central */}
          {!isPlaying && !loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <button
                onClick={togglePlay}
                className="bg-black bg-opacity-60 text-white p-4 rounded-full hover:bg-opacity-80 transition-opacity"
              >
                <Play className="h-8 w-8" />
              </button>
            </div>
          )}

          {/* Barra de controles inferior */}
          <div className="absolute bottom-0 left-0 right-0 p-4">
            {/* Barra de progresso */}
            {!isLive && duration > 0 && (
              <div className="mb-4">
                <input
                  type="range"
                  min="0"
                  max={duration}
                  value={currentTime}
                  onChange={handleSeek}
                  className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, #3b82f6 ${(currentTime / duration) * 100}%, rgba(255, 255, 255, 0.3) 0%)`
                  }}
                />
              </div>
            )}

            {/* Controles */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <button
                  onClick={togglePlay}
                  className="text-white hover:text-accent transition-colors"
                >
                  {isPlaying ? (
                    <Pause className="h-6 w-6" />
                  ) : (
                    <Play className="h-6 w-6" />
                  )}
                </button>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={toggleMute}
                    className="text-white hover:text-accent transition-colors"
                  >
                    {isMuted ? (
                      <VolumeX className="h-6 w-6" />
                    ) : (
                      <Volume2 className="h-6 w-6" />
                    )}
                  </button>

                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={isMuted ? 0 : volume}
                    onChange={handleVolumeSliderChange}
                    className="w-20 h-1 bg-gray-500 rounded-full appearance-none cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, white ${(isMuted ? 0 : volume) * 100}%, rgba(255, 255, 255, 0.3) 0%)`
                    }}
                  />
                </div>

                {/* Tempo */}
                <div className="text-white text-sm">
                  {isLive ? (
                    <span>Ao vivo</span>
                  ) : (
                    <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={toggleFullscreen}
                  className="text-white hover:text-accent transition-colors"
                  title="Tela cheia"
                >
                  {isFullscreen ? (
                    <Minimize className="h-5 w-5" />
                  ) : (
                    <Maximize className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoPlayer;