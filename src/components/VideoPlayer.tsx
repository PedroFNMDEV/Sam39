import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useStream } from '../context/StreamContext';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, X } from 'lucide-react';

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
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ 
  playlistVideo, 
  onVideoEnd, 
  className = "w-full",
  autoplay = false,
  controls = true
}) => {
  const { user } = useAuth();
  const { streamData } = useStream();
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

  const userLogin = user?.email?.split('@')[0] || `user_${user?.id || 'usuario'}`;

  useEffect(() => {
    // Verificar se há stream OBS ativo
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
    
    // Todos os vídeos agora são MP4, usar proxy /content do backend
    const cleanPath = url.replace(/^\/+/, '');
    return `/content/${cleanPath}`;
  };

  const videoSrc = playlistVideo?.url ? buildVideoUrl(playlistVideo.url) : 
    (streamData.isLive ? `http://samhost.wcore.com.br:1935/samhost/${userLogin}_live/playlist.m3u8` : 
     obsStreamActive ? obsStreamUrl : undefined);

  const videoTitle = playlistVideo?.nome || 
    (streamData.isLive ? streamData.title || 'Transmissão ao Vivo' : 
     obsStreamActive ? 'Transmissão OBS ao Vivo' : undefined);

  const isLive = !playlistVideo && (streamData.isLive || obsStreamActive);

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
    setError('Erro ao carregar vídeo');
  };

  const togglePlay = (e: React.MouseEvent) => {
    e.preventDefault();
    const video = document.querySelector('video');
    if (video) {
      if (isPlaying) {
        video.pause();
      } else {
        video.play().catch(console.error);
      }
    }
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.preventDefault();
    const video = document.querySelector('video');
    if (video) {
      video.muted = !video.muted;
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = document.querySelector('video');
    if (video && !isLive) {
      const newTime = parseFloat(e.target.value);
      video.currentTime = newTime;
    }
  };

  const handleVolumeSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = document.querySelector('video');
    if (video) {
      const newVolume = parseFloat(e.target.value);
      video.volume = newVolume;
      video.muted = newVolume === 0;
    }
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

  return (
    <div className={`video-container relative bg-black rounded-lg overflow-hidden ${className}`}>
      {/* Player HTML5 */}
      {videoSrc ? (
        <video
          src={videoSrc}
          className="w-full h-full object-contain"
          controls={controls}
          autoPlay={autoplay}
          muted={isMuted}
          preload="metadata"
          onPlay={handlePlay}
          onPause={handlePause}
          onEnded={handleEnded}
          onTimeUpdate={handleTimeUpdate}
          onDurationChange={handleDurationChange}
          onVolumeChange={handleVolumeChange}
          onError={handleError}
          crossOrigin="anonymous"
        >
          <source src={videoSrc} type="video/mp4" />
          <source src={videoSrc} type="application/vnd.apple.mpegurl" />
          Seu navegador não suporta reprodução de vídeo.
        </video>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900 text-white">
          <Play className="h-16 w-16 mb-4 text-gray-400" />
          <h3 className="text-xl font-semibold mb-2">Nenhum vídeo carregado</h3>
          <p className="text-gray-400 text-center max-w-md">
            Selecione um vídeo ou inicie uma transmissão para visualizar o conteúdo aqui
          </p>
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
          <div className="text-white text-center">
            <h3 className="text-lg font-semibold mb-2">Erro de Reprodução</h3>
            <p className="text-sm text-gray-300">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoPlayer;