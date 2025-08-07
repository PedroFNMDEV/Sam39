import React, { useState, useEffect } from 'react';
import { ChevronLeft, Video, Settings, Play, Trash2, RefreshCw, AlertCircle, CheckCircle, Zap, HardDrive, Clock, Download } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useAuth } from '../../context/AuthContext';

interface VideoConversion {
  id: number;
  nome: string;
  url: string;
  duracao?: number;
  tamanho?: number;
  bitrate_video?: number;
  formato_original?: string;
  status_conversao?: 'nao_iniciada' | 'em_andamento' | 'concluida' | 'erro';
  path_video_mp4?: string;
  data_conversao?: string;
  is_mp4: boolean;
  needs_conversion: boolean;
  can_use: boolean;
  bitrate_exceeds_limit: boolean;
  user_bitrate_limit: number;
}

interface Folder {
  id: number;
  nome: string;
}

interface ConversionSettings {
  target_bitrate: number;
  target_resolution: string;
  quality_preset: 'fast' | 'medium' | 'slow';
}

const ConversaoVideos: React.FC = () => {
  const { getToken, user } = useAuth();
  const [videos, setVideos] = useState<VideoConversion[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [converting, setConverting] = useState<Record<number, boolean>>({});
  const [showConversionModal, setShowConversionModal] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<VideoConversion | null>(null);
  const [conversionSettings, setConversionSettings] = useState<ConversionSettings>({
    target_bitrate: user?.bitrate || 2500,
    target_resolution: '1920x1080',
    quality_preset: 'medium'
  });

  useEffect(() => {
    loadFolders();
  }, []);

  useEffect(() => {
    if (selectedFolder) {
      loadVideos();
    }
  }, [selectedFolder]);

  const loadFolders = async () => {
    try {
      const token = await getToken();
      const response = await fetch('/api/folders', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      setFolders(data);
      
      // Selecionar primeira pasta por padrão
      if (data.length > 0) {
        setSelectedFolder(data[0].id.toString());
      }
    } catch (error) {
      toast.error('Erro ao carregar pastas');
    }
  };

  const loadVideos = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const url = selectedFolder ? 
        `/api/conversion/videos?folder_id=${selectedFolder}` : 
        '/api/conversion/videos';
        
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setVideos(data.videos);
        }
      }
    } catch (error) {
      console.error('Erro ao carregar vídeos:', error);
      toast.error('Erro ao carregar vídeos');
    } finally {
      setLoading(false);
    }
  };

  const openConversionModal = (video: VideoConversion) => {
    setSelectedVideo(video);
    setConversionSettings({
      target_bitrate: Math.min(video.bitrate_video || user?.bitrate || 2500, user?.bitrate || 2500),
      target_resolution: '1920x1080',
      quality_preset: 'medium'
    });
    setShowConversionModal(true);
  };

  const startConversion = async () => {
    if (!selectedVideo) return;

    setConverting(prev => ({ ...prev, [selectedVideo.id]: true }));
    setShowConversionModal(false);

    try {
      const token = await getToken();
      const response = await fetch('/api/conversion/convert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          video_id: selectedVideo.id,
          target_bitrate: conversionSettings.target_bitrate,
          target_resolution: conversionSettings.target_resolution,
          quality_preset: conversionSettings.quality_preset
        })
      });

      const result = await response.json();

      if (result.success) {
        toast.success('Conversão iniciada com sucesso!');
        
        // Atualizar status do vídeo
        setVideos(prev => prev.map(v => 
          v.id === selectedVideo.id ? 
          { ...v, status_conversao: 'em_andamento' } : v
        ));

        // Verificar progresso a cada 5 segundos
        const progressInterval = setInterval(async () => {
          try {
            const statusResponse = await fetch(`/api/conversion/status/${selectedVideo.id}`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            
            if (statusResponse.ok) {
              const statusData = await statusResponse.json();
              if (statusData.success) {
                const status = statusData.conversion_status.status;
                
                if (status === 'concluida') {
                  clearInterval(progressInterval);
                  setConverting(prev => ({ ...prev, [selectedVideo.id]: false }));
                  toast.success(`Conversão de "${selectedVideo.nome}" concluída!`);
                  loadVideos(); // Recarregar lista
                } else if (status === 'erro') {
                  clearInterval(progressInterval);
                  setConverting(prev => ({ ...prev, [selectedVideo.id]: false }));
                  toast.error(`Erro na conversão de "${selectedVideo.nome}"`);
                  loadVideos();
                }
              }
            }
          } catch (error) {
            console.error('Erro ao verificar progresso:', error);
          }
        }, 5000);

        // Timeout de 10 minutos
        setTimeout(() => {
          clearInterval(progressInterval);
          setConverting(prev => ({ ...prev, [selectedVideo.id]: false }));
        }, 600000);

      } else {
        toast.error(result.error || 'Erro ao iniciar conversão');
      }
    } catch (error) {
      console.error('Erro ao converter vídeo:', error);
      toast.error('Erro ao converter vídeo');
    } finally {
      setConverting(prev => ({ ...prev, [selectedVideo.id]: false }));
    }
  };

  const removeConversion = async (videoId: number) => {
    if (!confirm('Deseja remover a conversão deste vídeo?')) return;

    try {
      const token = await getToken();
      const response = await fetch(`/api/conversion/${videoId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        toast.success('Conversão removida com sucesso!');
        loadVideos();
      } else {
        const errorData = await response.json();
        toast.error(errorData.error || 'Erro ao remover conversão');
      }
    } catch (error) {
      toast.error('Erro ao remover conversão');
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  };

  const formatDuration = (seconds: number): string => {
    if (!seconds) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const getStatusIcon = (video: VideoConversion) => {
    if (converting[video.id]) {
      return <RefreshCw className="h-4 w-4 text-blue-600 animate-spin" />;
    }

    switch (video.status_conversao) {
      case 'concluida':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'em_andamento':
        return <RefreshCw className="h-4 w-4 text-blue-600 animate-spin" />;
      case 'erro':
        return <AlertCircle className="h-4 w-4 text-red-600" />;
      default:
        if (video.needs_conversion) {
          return <AlertCircle className="h-4 w-4 text-yellow-600" />;
        }
        return <CheckCircle className="h-4 w-4 text-green-600" />;
    }
  };

  const getStatusText = (video: VideoConversion) => {
    if (converting[video.id]) {
      return 'Convertendo...';
    }

    switch (video.status_conversao) {
      case 'concluida':
        return 'Convertido';
      case 'em_andamento':
        return 'Convertendo...';
      case 'erro':
        return 'Erro na conversão';
      default:
        if (video.needs_conversion) {
          return video.bitrate_exceeds_limit ? 'Bitrate excede limite' : 'Precisa converter';
        }
        return video.is_mp4 ? 'MP4 Original' : 'Compatível';
    }
  };

  const getStatusColor = (video: VideoConversion) => {
    if (converting[video.id]) {
      return 'text-blue-600';
    }

    switch (video.status_conversao) {
      case 'concluida':
        return 'text-green-600';
      case 'em_andamento':
        return 'text-blue-600';
      case 'erro':
        return 'text-red-600';
      default:
        if (video.needs_conversion) {
          return video.bitrate_exceeds_limit ? 'text-red-600' : 'text-yellow-600';
        }
        return 'text-green-600';
    }
  };

  const canUseVideo = (video: VideoConversion) => {
    return video.can_use && !video.bitrate_exceeds_limit;
  };

  const needsConversion = videos.filter(v => v.needs_conversion && v.status_conversao !== 'concluida').length;
  const convertedVideos = videos.filter(v => v.status_conversao === 'concluida').length;
  const blockedVideos = videos.filter(v => v.bitrate_exceeds_limit && v.status_conversao !== 'concluida').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center mb-6">
        <Link to="/dashboard" className="flex items-center text-primary-600 hover:text-primary-800">
          <ChevronLeft className="h-5 w-5 mr-1" />
          <span>Voltar ao Dashboard</span>
        </Link>
      </div>

      <div className="flex items-center space-x-3">
        <Video className="h-8 w-8 text-primary-600" />
        <h1 className="text-3xl font-bold text-gray-900">Conversão de Vídeos</h1>
      </div>

      {/* Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="flex items-center">
            <div className="p-3 bg-blue-100 rounded-lg">
              <Video className="h-6 w-6 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Total de Vídeos</p>
              <p className="text-2xl font-bold text-gray-900">{videos.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="flex items-center">
            <div className="p-3 bg-yellow-100 rounded-lg">
              <Settings className="h-6 w-6 text-yellow-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Precisam Conversão</p>
              <p className="text-2xl font-bold text-gray-900">{needsConversion}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="flex items-center">
            <div className="p-3 bg-green-100 rounded-lg">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Convertidos</p>
              <p className="text-2xl font-bold text-gray-900">{convertedVideos}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="flex items-center">
            <div className="p-3 bg-red-100 rounded-lg">
              <AlertCircle className="h-6 w-6 text-red-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Bloqueados</p>
              <p className="text-2xl font-bold text-gray-900">{blockedVideos}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-800">Filtros</h2>
          <button
            onClick={loadVideos}
            disabled={loading}
            className="bg-primary-600 text-white px-4 py-2 rounded-md hover:bg-primary-700 disabled:opacity-50 flex items-center"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Pasta
            </label>
            <select
              value={selectedFolder}
              onChange={(e) => setSelectedFolder(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="">Todas as pastas</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.nome}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <div className="text-sm text-gray-600">
              <p>Limite do seu plano: <strong>{user?.bitrate || 2500} kbps</strong></p>
              <p>Armazenamento: <strong>{user?.espaco || 1000} MB</strong></p>
            </div>
          </div>
        </div>
      </div>

      {/* Avisos importantes */}
      {blockedVideos > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <div className="flex items-start">
            <AlertCircle className="h-5 w-5 text-red-600 mr-3 mt-0.5" />
            <div>
              <h3 className="text-red-900 font-medium mb-2">⚠️ Vídeos Bloqueados</h3>
              <p className="text-red-800 mb-2">
                {blockedVideos} vídeo(s) possuem bitrate superior ao limite do seu plano ({user?.bitrate || 2500} kbps) 
                e não podem ser usados em transmissões até serem convertidos.
              </p>
              <p className="text-red-700 text-sm">
                Use a conversão para reduzir o bitrate e tornar os vídeos compatíveis com seu plano.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Lista de vídeos */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-6">Vídeos para Conversão</h2>

        {videos.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Video className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p className="text-lg mb-2">Nenhum vídeo encontrado</p>
            <p className="text-sm">Selecione uma pasta ou envie vídeos primeiro</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Vídeo</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-700">Formato</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-700">Bitrate</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-700">Tamanho</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-700">Status</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-700">Ações</th>
                </tr>
              </thead>
              <tbody>
                {videos.map((video) => (
                  <tr key={video.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4">
                      <div className="flex items-center space-x-3">
                        <Video className="h-5 w-5 text-gray-400" />
                        <div>
                          <div className="font-medium text-gray-900 truncate max-w-xs" title={video.nome}>
                            {video.nome}
                          </div>
                          {video.duracao && (
                            <div className="text-sm text-gray-500">
                              {formatDuration(video.duracao)}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    
                    <td className="py-3 px-4 text-center">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        video.is_mp4 ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {video.formato_original?.toUpperCase() || 'N/A'}
                      </span>
                    </td>
                    
                    <td className="py-3 px-4 text-center">
                      <div className="flex flex-col items-center">
                        <span className={`font-medium ${
                          video.bitrate_exceeds_limit ? 'text-red-600' : 'text-gray-900'
                        }`}>
                          {video.bitrate_video || 'N/A'} kbps
                        </span>
                        {video.bitrate_exceeds_limit && (
                          <span className="text-xs text-red-600">
                            Limite: {video.user_bitrate_limit} kbps
                          </span>
                        )}
                      </div>
                    </td>
                    
                    <td className="py-3 px-4 text-center text-sm text-gray-600">
                      {video.tamanho ? formatFileSize(video.tamanho) : 'N/A'}
                    </td>
                    
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center space-x-2">
                        {getStatusIcon(video)}
                        <span className={`text-sm font-medium ${getStatusColor(video)}`}>
                          {getStatusText(video)}
                        </span>
                      </div>
                    </td>
                    
                    <td className="py-3 px-4 text-center">
                      <div className="flex justify-center space-x-2">
                        {video.needs_conversion && video.status_conversao !== 'concluida' && (
                          <button
                            onClick={() => openConversionModal(video)}
                            disabled={converting[video.id] || video.status_conversao === 'em_andamento'}
                            className="text-blue-600 hover:text-blue-800 disabled:opacity-50 p-1"
                            title="Converter vídeo"
                          >
                            <Settings className="h-4 w-4" />
                          </button>
                        )}
                        
                        {video.status_conversao === 'concluida' && (
                          <button
                            onClick={() => removeConversion(video.id)}
                            className="text-red-600 hover:text-red-800 p-1"
                            title="Remover conversão"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                        
                        {canUseVideo(video) && (
                          <button
                            onClick={() => {
                              // Abrir vídeo em nova aba
                              const videoUrl = video.path_video_mp4 || video.url;
                              window.open(`/content/${videoUrl}`, '_blank');
                            }}
                            className="text-green-600 hover:text-green-800 p-1"
                            title="Visualizar vídeo"
                          >
                            <Play className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de Configuração de Conversão */}
      {showConversionModal && selectedVideo && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full">
            <div className="p-6 border-b border-gray-200">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">Configurar Conversão</h3>
                <button
                  onClick={() => setShowConversionModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ×
                </button>
              </div>
              <p className="text-sm text-gray-600 mt-2">
                Vídeo: {selectedVideo.nome}
              </p>
            </div>

            <div className="p-6 space-y-6">
              {/* Informações do vídeo atual */}
              <div className="bg-gray-50 p-4 rounded-lg">
                <h4 className="font-medium text-gray-800 mb-3">Informações Atuais</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">Formato:</span>
                    <span className="ml-2 font-medium">{selectedVideo.formato_original?.toUpperCase() || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Bitrate:</span>
                    <span className={`ml-2 font-medium ${
                      selectedVideo.bitrate_exceeds_limit ? 'text-red-600' : 'text-gray-900'
                    }`}>
                      {selectedVideo.bitrate_video || 'N/A'} kbps
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600">Tamanho:</span>
                    <span className="ml-2 font-medium">
                      {selectedVideo.tamanho ? formatFileSize(selectedVideo.tamanho) : 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600">Duração:</span>
                    <span className="ml-2 font-medium">
                      {selectedVideo.duracao ? formatDuration(selectedVideo.duracao) : 'N/A'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Configurações de conversão */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Bitrate de Destino (kbps)
                  </label>
                  <input
                    type="number"
                    min="500"
                    max={user?.bitrate || 2500}
                    value={conversionSettings.target_bitrate}
                    onChange={(e) => setConversionSettings(prev => ({ 
                      ...prev, 
                      target_bitrate: Math.min(parseInt(e.target.value) || 0, user?.bitrate || 2500)
                    }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Máximo permitido: {user?.bitrate || 2500} kbps
                  </p>
                  {conversionSettings.target_bitrate > (user?.bitrate || 2500) && (
                    <p className="text-xs text-red-600 mt-1">
                      ⚠️ Bitrate excede o limite do seu plano
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Resolução de Destino
                  </label>
                  <select
                    value={conversionSettings.target_resolution}
                    onChange={(e) => setConversionSettings(prev => ({ 
                      ...prev, 
                      target_resolution: e.target.value 
                    }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="1920x1080">1080p (1920x1080)</option>
                    <option value="1280x720">720p (1280x720)</option>
                    <option value="854x480">480p (854x480)</option>
                    <option value="640x360">360p (640x360)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Qualidade de Conversão
                  </label>
                  <select
                    value={conversionSettings.quality_preset}
                    onChange={(e) => setConversionSettings(prev => ({ 
                      ...prev, 
                      quality_preset: e.target.value as any
                    }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="fast">Rápida (menor qualidade)</option>
                    <option value="medium">Média (balanceada)</option>
                    <option value="slow">Lenta (melhor qualidade)</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Qualidade mais alta = conversão mais lenta
                  </p>
                </div>
              </div>

              {/* Estimativa */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-medium text-blue-900 mb-2">📊 Estimativa da Conversão</h4>
                <div className="text-blue-800 text-sm space-y-1">
                  <p>• Formato final: MP4 (H.264 + AAC)</p>
                  <p>• Bitrate: {conversionSettings.target_bitrate} kbps</p>
                  <p>• Resolução: {conversionSettings.target_resolution}</p>
                  <p>• Qualidade: {conversionSettings.quality_preset}</p>
                  <p>• Tempo estimado: {
                    conversionSettings.quality_preset === 'fast' ? '2-5 minutos' :
                    conversionSettings.quality_preset === 'medium' ? '5-10 minutos' :
                    '10-20 minutos'
                  }</p>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => setShowConversionModal(false)}
                className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
              >
                Cancelar
              </button>
              <button
                onClick={startConversion}
                disabled={conversionSettings.target_bitrate > (user?.bitrate || 2500)}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center"
              >
                <Settings className="h-4 w-4 mr-2" />
                Iniciar Conversão
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Informações de ajuda */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <div className="flex items-start">
          <AlertCircle className="h-5 w-5 text-blue-600 mr-3 mt-0.5" />
          <div>
            <h3 className="text-blue-900 font-medium mb-2">Como funciona a conversão</h3>
            <ul className="text-blue-800 text-sm space-y-1">
              <li>• Todos os vídeos são convertidos para MP4 (H.264 + AAC) para máxima compatibilidade</li>
              <li>• O bitrate é ajustado conforme o limite do seu plano</li>
              <li>• Vídeos com bitrate superior ao limite são bloqueados até conversão</li>
              <li>• A conversão preserva a qualidade visual dentro do bitrate especificado</li>
              <li>• Após conversão, o vídeo original é mantido como backup</li>
              <li>• Players usarão automaticamente a versão MP4 convertida</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConversaoVideos;