import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Listbox } from '@headlessui/react';
import axios from 'axios';
import type { ReactElement } from 'react';

const currencies = [
  { id: 1, name: 'USD', label: 'US Dollar' },
  { id: 2, name: 'EUR', label: 'Euro' },
  { id: 3, name: 'GBP', label: 'British Pound' },
  { id: 4, name: 'JPY', label: 'Japanese Yen' },
  { id: 5, name: 'AUD', label: 'Australian Dollar' },
  { id: 6, name: 'PHP', label: 'Philippine Peso' },
];

function App(): ReactElement {
  const [fromCurrency, setFromCurrency] = useState(currencies[5]);
  const [toCurrency, setToCurrency] = useState(currencies[0]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [convertedAmount, setConvertedAmount] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [detectedBounds, setDetectedBounds] = useState<{ x: number, y: number, width: number, height: number } | null>(null);
  const [detectedText, setDetectedText] = useState<string | null>(null);
  const cancelTokenSource = useRef(axios.CancelToken.source());
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);

  const processConversion = async (amount: string) => {
    setIsProcessing(true);
    setIsModalOpen(true);
    cancelTokenSource.current = axios.CancelToken.source();

    try {
      const response = await axios.get(
        `https://api.frankfurter.app/latest?from=${fromCurrency.name}&to=${toCurrency.name}&amount=${amount}`,
        { cancelToken: cancelTokenSource.current.token }
      );
      
      if (response.data?.rates?.[toCurrency.name]) {
        setConvertedAmount(`${toCurrency.name} ${response.data.rates[toCurrency.name].toFixed(2)}`);
      }
    } catch (err) {
      if (!axios.isCancel(err)) {
        setConvertedAmount('Conversion failed');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const startCamera = async () => {
    try {
      const constraints = {
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await new Promise((resolve) => {
          if (videoRef.current) {
            videoRef.current.onloadedmetadata = () => {
              resolve(true);
            };
          }
        });
        
        videoRef.current.play();
        setIsVideoPlaying(true);
      }
    } catch (err) {
      console.error('Error accessing camera:', err);
      setDetectedText('Error accessing camera. Please check permissions.');
      setIsModalOpen(true);
    }
  };

  const resetCamera = () => {
    if (videoRef.current) {
      videoRef.current.play();
    }
    
    setDetectedBounds(null);
    setIsModalOpen(false);
    setDetectedText(null);
    setConvertedAmount(null);
    setIsProcessing(false);
  };

  const captureImage = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    setIsProcessing(true);
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    if (!context) return;

    try {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      console.log('📸 Capturing image...');
      const imageBase64 = canvas.toDataURL('image/jpeg').split(',')[1];

      console.log('🚀 Sending image to server...');
      const response = await axios.post('http://localhost:3001/api/detect-text', {
        image: imageBase64
      });

      console.log('✅ Server response:', response.data);

      const textAnnotations = response.data.responses[0]?.textAnnotations;
      if (!textAnnotations || textAnnotations.length === 0) {
        throw new Error('No text detected in image');
      }

      const detectedText = textAnnotations[0].description;
      console.log('📝 Detected text:', detectedText);

      const boundingBox = textAnnotations[0].boundingPoly.vertices;
      setDetectedBounds({
        x: boundingBox[0].x,
        y: boundingBox[0].y,
        width: boundingBox[1].x - boundingBox[0].x,
        height: boundingBox[2].y - boundingBox[0].y
      });

      const numberMatch = detectedText.match(/[\$\€\£\¥\₱]?\s*\d+(?:[.,]\d{1,2})?/);
      if (numberMatch) {
        const cleanNumber = numberMatch[0].replace(/[^\d.]/g, '');
        setDetectedText(numberMatch[0]);
        setIsModalOpen(true);
        processConversion(cleanNumber);
      } else {
        throw new Error('No valid number found in detected text');
      }
    } catch (err) {
      console.error('❌ Error processing image:', err);
      setIsModalOpen(true);
      setDetectedText(err.message || 'Error detecting text. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  useEffect(() => {
    startCamera();
    
    return () => {
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="max-w-md mx-auto p-4">
        {/* Currency Selection */}
        <div className="flex gap-4 mb-4">
          <Listbox value={fromCurrency} onChange={setFromCurrency}>
            <div className="relative flex-1">
              <Listbox.Button className="w-full bg-white py-2 px-3 rounded-lg text-left shadow">
                {fromCurrency.label}
              </Listbox.Button>
              <Listbox.Options className="absolute w-full mt-1 bg-white rounded-lg shadow-lg max-h-60 overflow-auto z-50">
                {currencies.map((currency) => (
                  <Listbox.Option
                    key={currency.id}
                    value={currency}
                    className={({ active }) =>
                      `${active ? 'bg-blue-100' : ''} cursor-pointer select-none py-2 px-3`
                    }
                  >
                    {currency.label}
                  </Listbox.Option>
                ))}
              </Listbox.Options>
            </div>
          </Listbox>

          <Listbox value={toCurrency} onChange={setToCurrency}>
            <div className="relative flex-1">
              <Listbox.Button className="w-full bg-white py-2 px-3 rounded-lg text-left shadow">
                {toCurrency.label}
              </Listbox.Button>
              <Listbox.Options className="absolute w-full mt-1 bg-white rounded-lg shadow-lg max-h-60 overflow-auto z-50">
                {currencies.map((currency) => (
                  <Listbox.Option
                    key={currency.id}
                    value={currency}
                    className={({ active }) =>
                      `${active ? 'bg-blue-100' : ''} cursor-pointer select-none py-2 px-3`
                    }
                  >
                    {currency.label}
                  </Listbox.Option>
                ))}
              </Listbox.Options>
            </div>
          </Listbox>
        </div>

        {/* Camera View */}
        <div className="relative aspect-[3/4] bg-black rounded-lg overflow-hidden z-0">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          <canvas ref={canvasRef} className="hidden" />

          {/* Detection Overlay */}
          {detectedBounds && (
            <div
              className="absolute border-2 border-green-500 bg-green-500 bg-opacity-20 transition-all duration-200"
              style={{
                left: `${detectedBounds.x}px`,
                top: `${detectedBounds.y}px`,
                width: `${detectedBounds.width}px`,
                height: `${detectedBounds.height}px`
              }}
            />
          )}
        </div>

        {/* Capture Button */}
        <button
          onClick={captureImage}
          className="mt-4 w-full bg-blue-600 text-white py-3 rounded-lg shadow-md hover:bg-blue-700 transition-colors"
          disabled={isProcessing}
        >
          {isProcessing ? 'Processing...' : 'Capture & Convert'}
        </button>

        {/* Result Modal */}
        <AnimatePresence>
          {isModalOpen && (
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              className="fixed bottom-0 left-0 right-0 bg-white rounded-t-xl shadow-lg p-6 z-50"
            >
              <div className="text-center">
                {isProcessing ? (
                  <div className="flex flex-col items-center gap-2">
                    <svg className="animate-spin h-8 w-8 text-blue-600" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    <p className="text-lg font-semibold">Converting...</p>
                    <p className="text-sm text-gray-600">
                      {fromCurrency.name} → {toCurrency.name}
                    </p>
                  </div>
                ) : (
                  <>
                    <h3 className="text-lg font-semibold mb-2">Conversion Result</h3>
                    <p className="text-sm text-gray-600 mb-2">
                      {detectedText} {fromCurrency.name} = 
                    </p>
                    <p className="text-3xl font-bold text-blue-600">{convertedAmount}</p>
                    <button
                      onClick={() => {
                        setIsModalOpen(false);
                        resetCamera();
                      }}
                      className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg"
                    >
                      Close
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default App;