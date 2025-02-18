import React, { useState, useRef } from 'react';
import { createWorker, createScheduler, PSM } from 'tesseract.js';
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
  const [isVideoPlaying, setIsVideoPlaying] = useState(true);
  const [detectedNumber, setDetectedNumber] = useState<string | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [pendingAmount, setPendingAmount] = useState<string | null>(null);
  const [detectedText, setDetectedText] = useState<string | null>(null);

  const preprocessImage = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Get image data
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Increase contrast and convert to grayscale
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      // Convert to grayscale
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      
      // Increase contrast
      const contrast = 1.5; // Adjust this value to increase/decrease contrast
      const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
      const newValue = factor * (gray - 128) + 128;
      
      // Apply threshold
      const final = newValue > 128 ? 255 : 0;
      
      data[i] = final;
      data[i + 1] = final;
      data[i + 2] = final;
    }

    ctx.putImageData(imageData, 0, 0);
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('Error accessing camera:', err);
    }
  };

  const processConversion = async () => {
    if (!pendingAmount) return;
    
    setShowConfirmation(false);
    setIsProcessing(true);

    try {
      // The API expects a different format
      const response = await axios.get(
        `https://api.frankfurter.app/latest?from=${fromCurrency.name}&to=${toCurrency.name}&amount=${pendingAmount}`
      );
      
      if (response.data && response.data.rates) {
        const convertedValue = response.data.rates[toCurrency.name];
        if (convertedValue) {
          setConvertedAmount(`${toCurrency.name} ${convertedValue.toFixed(2)}`);
          setIsModalOpen(true);
        } else {
          throw new Error('Currency not found in response');
        }
      } else {
        throw new Error('Invalid API response format');
      }
    } catch (err) {
      console.error('Error converting currency:', err);
      setDetectedText('Conversion failed. Please try again.');
      setShowConfirmation(true);
    } finally {
      setIsProcessing(false);
    }
  };

  const captureImage = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    // Pause the video feed
    if (videoRef.current) {
      videoRef.current.pause();
      setIsVideoPlaying(false);
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    if (!context) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Preprocess the image
    preprocessImage(canvas);

    setIsProcessing(true);
    setDetectedNumber(null);
    setPendingAmount(null);
    setShowConfirmation(false);

    try {
      const scheduler = createScheduler();
      const worker = await createWorker();
      await worker.loadLanguage('eng');
      await worker.initialize('eng');
      
      // Configure Tesseract for better number recognition
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789.,₱$€£¥',
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        tessedit_ocr_engine_mode: 1, // Neural net LSTM only
        preserve_interword_spaces: '1',
        textord_heavy_nr: '1',
        textord_min_linesize: '2.5',
      });

      scheduler.addWorker(worker);

      const { data } = await worker.recognize(canvas, {
        rectangle: { // Focus on the center area of the image
          top: Math.floor(canvas.height * 0.3),
          left: Math.floor(canvas.width * 0.2),
          width: Math.floor(canvas.width * 0.6),
          height: Math.floor(canvas.height * 0.4)
        }
      });

      await worker.terminate();

      // Enhanced currency pattern
      const currencyPattern = /(?:[\$\€\£\¥\₱]?\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?)|(?:\d{1,3}(?:,\d{3})*(?:\.\d{2})?\s*[\$\€\£\¥\₱]?)/;
      const numberMatch = data.text.match(currencyPattern);
      
      if (numberMatch && data.words && data.words.length > 0) {
        const matchedWord = data.words.find(word => 
          word.text.includes(numberMatch[0]) || 
          word.text.replace(/[,\s]/g, '').includes(numberMatch[0].replace(/[,\s]/g, ''))
        );
        
        if (matchedWord) {
          const { bbox } = matchedWord;
          const videoElement = videoRef.current;
          const scaleX = videoElement.offsetWidth / canvas.width;
          const scaleY = videoElement.offsetHeight / canvas.height;

          setDetectedBounds({
            x: bbox.x0 * scaleX,
            y: bbox.y0 * scaleY,
            width: (bbox.x1 - bbox.x0) * scaleX,
            height: (bbox.y1 - bbox.y0) * scaleY
          });
          
          const cleanNumber = numberMatch[0].replace(/[^\d.]/g, '');
          setDetectedText(numberMatch[0]);
          setPendingAmount(cleanNumber);
          setShowConfirmation(true);
        } else {
          setShowConfirmation(true);
          setDetectedText('No price found. Please try again.');
        }
      } else {
        setShowConfirmation(true);
        setDetectedText('No price found. Please try again.');
      }
    } catch (err) {
      console.error('Error processing image:', err);
      setShowConfirmation(true);
      setDetectedText('Error processing image. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const resetCamera = () => {
    // Resume video feed
    if (videoRef.current) {
      videoRef.current.play();
      setIsVideoPlaying(true);
    }
    
    // Reset all states to initial values
    setDetectedBounds(null);
    setIsModalOpen(false);
    setShowConfirmation(false);
    setPendingAmount(null);
    setDetectedText(null);
    setDetectedNumber(null);
    setConvertedAmount(null);
    setIsProcessing(false);
  };

  React.useEffect(() => {
    startCamera();
    return () => {
      if (videoRef.current?.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="p-4">
        <div className="space-y-4 relative z-10 mb-4">
          {/* From Currency Dropdown */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              From Currency
            </label>
            <Listbox value={fromCurrency} onChange={setFromCurrency}>
              <div className="relative mt-1">
                <Listbox.Button className="relative w-full py-2 pl-3 pr-10 text-left bg-white rounded-lg shadow-md cursor-pointer">
                  <span className="block truncate">{fromCurrency.label}</span>
                </Listbox.Button>
                <Listbox.Options className="absolute w-full py-1 mt-1 overflow-auto text-base bg-white rounded-md shadow-lg max-h-60 ring-1 ring-black ring-opacity-5 focus:outline-none">
                  {currencies.map((currency) => (
                    <Listbox.Option
                      key={currency.id}
                      value={currency}
                      className={({ active }) =>
                        `${active ? 'text-white bg-blue-600' : 'text-gray-900'}
                        cursor-pointer select-none relative py-2 pl-10 pr-4`
                      }
                    >
                      {currency.label}
                    </Listbox.Option>
                  ))}
                </Listbox.Options>
              </div>
            </Listbox>
          </div>

          {/* To Currency Dropdown */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              To Currency
            </label>
            <Listbox value={toCurrency} onChange={setToCurrency}>
              <div className="relative mt-1">
                <Listbox.Button className="relative w-full py-2 pl-3 pr-10 text-left bg-white rounded-lg shadow-md cursor-pointer">
                  <span className="block truncate">{toCurrency.label}</span>
                </Listbox.Button>
                <Listbox.Options className="absolute w-full py-1 mt-1 overflow-auto text-base bg-white rounded-md shadow-lg max-h-60 ring-1 ring-black ring-opacity-5 focus:outline-none">
                  {currencies.map((currency) => (
                    <Listbox.Option
                      key={currency.id}
                      value={currency}
                      className={({ active }) =>
                        `${active ? 'text-white bg-blue-600' : 'text-gray-900'}
                        cursor-pointer select-none relative py-2 pl-10 pr-4`
                      }
                    >
                      {currency.label}
                    </Listbox.Option>
                  ))}
                </Listbox.Options>
              </div>
            </Listbox>
          </div>
        </div>

        <div className="relative aspect-[3/4] bg-black rounded-lg overflow-hidden z-0">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
          <canvas ref={canvasRef} className="hidden" />
          
          {!isVideoPlaying && (
            <button
              onClick={resetCamera}
              className="absolute top-4 right-4 bg-white bg-opacity-75 text-black px-3 py-1 rounded-lg"
            >
              Reset Camera
            </button>
          )}
          
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
          
          {isProcessing && (
            <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
              <div className="text-white text-center">
                <div>Processing...</div>
                {detectedNumber && (
                  <div className="mt-2 text-sm opacity-75">Detected: {detectedNumber}</div>
                )}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={captureImage}
          className="mt-4 w-full bg-blue-600 text-white py-3 rounded-lg shadow-md hover:bg-blue-700 transition-colors"
          disabled={isProcessing || !isVideoPlaying}
        >
          Capture & Convert
        </button>
      </div>

      <AnimatePresence>
        {/* Result modal should come first in the DOM */}
        {isModalOpen && (
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 500 }}
            className="fixed bottom-0 left-0 right-0 bg-white rounded-t-xl shadow-lg p-6 z-50"
          >
            <div className="text-center">
              <h3 className="text-lg font-semibold mb-2">Converted Amount</h3>
              <p className="text-sm text-gray-600 mb-2">
                {detectedText} {fromCurrency.name} = 
              </p>
              <p className="text-3xl font-bold text-blue-600">{convertedAmount}</p>
              <button
                onClick={resetCamera}
                className="mt-4 text-gray-600"
              >
                Close
              </button>
            </div>
          </motion.div>
        )}
        
        {showConfirmation && (
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 500 }}
            className="fixed bottom-0 left-0 right-0 bg-white rounded-t-xl shadow-lg p-6 z-40"
          >
            <div className="text-center">
              {pendingAmount ? (
                <>
                  <h3 className="text-lg font-semibold mb-2">Confirm Conversion</h3>
                  <p className="text-sm text-gray-600 mb-2">
                    Detected amount: {detectedText}
                  </p>
                  <p className="text-sm text-gray-600 mb-4">
                    Convert from {fromCurrency.name} to {toCurrency.name}?
                  </p>
                  <div className="flex space-x-4 justify-center">
                    <button
                      onClick={processConversion}
                      className="px-6 py-2 bg-blue-600 text-white rounded-lg"
                    >
                      Convert
                    </button>
                    <button
                      onClick={resetCamera}
                      className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-semibold mb-4 text-red-600">Detection Failed</h3>
                  <p className="text-sm text-gray-600 mb-4">{detectedText}</p>
                  <button
                    onClick={resetCamera}
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg"
                  >
                    Try Again
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;