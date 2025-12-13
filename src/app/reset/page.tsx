'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function ResetPage() {
  const [status, setStatus] = useState('Clearing cache and storage...');
  const [done, setDone] = useState(false);

  useEffect(() => {
    async function reset() {
      try {
        // Clear localStorage
        setStatus('Clearing localStorage...');
        localStorage.clear();
        
        // Clear sessionStorage
        setStatus('Clearing sessionStorage...');
        sessionStorage.clear();
        
        // Unregister service workers
        setStatus('Unregistering service workers...');
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const registration of registrations) {
            await registration.unregister();
          }
        }
        
        // Clear caches
        setStatus('Clearing caches...');
        if ('caches' in window) {
          const cacheNames = await caches.keys();
          for (const cacheName of cacheNames) {
            await caches.delete(cacheName);
          }
        }
        
        // Clear IndexedDB databases
        setStatus('Clearing IndexedDB...');
        if ('indexedDB' in window) {
          const databases = await indexedDB.databases?.() || [];
          for (const db of databases) {
            if (db.name) {
              indexedDB.deleteDatabase(db.name);
            }
          }
        }

        setStatus('All cleared! Redirecting...');
        setDone(true);
        
        // Redirect after a short delay
        setTimeout(() => {
          window.location.href = '/?cleared=1';
        }, 1500);
        
      } catch (error) {
        setStatus(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        setDone(true);
      }
    }
    
    reset();
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0a0a0a',
      color: '#fff',
      fontFamily: 'monospace',
      padding: 20,
    }}>
      <div style={{
        background: '#141414',
        border: '1px solid #333',
        borderRadius: 8,
        padding: 32,
        maxWidth: 400,
        textAlign: 'center',
      }}>
        <h1 style={{ fontSize: 24, marginBottom: 16, color: '#faad14' }}>
          🔄 SKISHADE Reset
        </h1>
        
        <p style={{ fontSize: 14, color: '#888', marginBottom: 24 }}>
          Clearing all cached data and storage...
        </p>
        
        <div style={{
          background: '#0a0a0a',
          padding: 12,
          borderRadius: 4,
          marginBottom: 16,
        }}>
          <code style={{ fontSize: 12, color: done ? '#52c41a' : '#faad14' }}>
            {status}
          </code>
        </div>
        
        {done && (
          <p style={{ fontSize: 12, color: '#666' }}>
            If not redirected automatically,{' '}
            <Link href="/" style={{ color: '#faad14' }}>click here</Link>
          </p>
        )}
      </div>
    </div>
  );
}

