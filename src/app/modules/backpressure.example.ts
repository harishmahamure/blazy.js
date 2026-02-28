/**
 * Backpressure Handling Examples for Blazy.JS
 * 
 * When sending large data to slow clients, you MUST handle backpressure
 * to prevent memory exhaustion. These examples show how.
 */

import type { App } from '../../core/app.js';
import type { Context } from '../../core/context.js';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';

export function backpressureExamples(app: App): void {

  /**
   * Example 1: Stream large file with backpressure handling
   * DON'T use fs.readFileSync() for large files - it loads everything into memory!
   */
  app.get('/api/download/large-file', async (ctx) => {
    const filePath = './data/large-file.bin'; // 100MB file
    
    try {
      const stats = await stat(filePath);
      const fileSize = stats.size;

      // Create async generator from Node.js stream
      async function* fileChunks() {
        const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 }); // 64KB chunks
        
        for await (const chunk of stream) {
          if (ctx.aborted) {
            stream.destroy();
            break;
          }
          yield chunk as Buffer;
        }
      }

      ctx.setHeader('Content-Disposition', 'attachment; filename="large-file.bin"');
      
      const success = await ctx.stream(
        fileChunks(),
        'application/octet-stream',
        200,
        fileSize
      );

      if (!success) {
        console.log('Stream aborted or failed');
      }
    } catch (error) {
      if (!ctx.aborted) {
        ctx.status(500).json({ error: 'Failed to stream file' });
      }
    }
  });

  /**
   * Example 2: Stream database results (avoid loading all rows into memory)
   */
  app.get('/api/export/users', async (ctx) => {
    async function* userRows() {
      // Simulate database cursor/stream
      let offset = 0;
      const batchSize = 1000;
      
      while (true) {
        if (ctx.aborted) break;
        
        // Fetch batch from database
        const users = await fetchUsersBatch(offset, batchSize);
        
        if (users.length === 0) break;
        
        // Convert to CSV chunk
        const csvChunk = users.map(u => 
          `${u.id},${u.name},${u.email}\n`
        ).join('');
        
        yield Buffer.from(csvChunk);
        
        offset += batchSize;
        
        if (users.length < batchSize) break; // Last batch
      }
    }

    ctx.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
    ctx.setHeader('Content-Type', 'text/csv');
    
    // Stream without knowing total size
    await ctx.stream(userRows());
  });

  /**
   * Example 3: Send large JSON array with chunking
   * Instead of JSON.stringify(largeArray) which buffers everything
   */
  app.get('/api/data/large-array', async (ctx) => {
    const items = await fetchLargeDataset(); // 10,000 items
    
    async function* jsonChunks() {
      yield Buffer.from('[');
      
      for (let i = 0; i < items.length; i++) {
        if (ctx.aborted) break;
        
        const json = JSON.stringify(items[i]);
        const chunk = i < items.length - 1 ? `${json},` : json;
        yield Buffer.from(chunk);
      }
      
      yield Buffer.from(']');
    }

    await ctx.stream(jsonChunks(), 'application/json');
  });

  /**
   * Example 4: Use sendLarge() for simple buffer responses
   * Automatically chunks and handles backpressure
   */
  app.get('/api/report/pdf', async (ctx) => {
    // Generate large PDF (10MB)
    const pdfBuffer = await generateLargePDF();
    
    ctx.setHeader('Content-Disposition', 'attachment; filename="report.pdf"');
    
    // sendLarge automatically chunks into 64KB pieces
    const success = await ctx.sendLarge(
      pdfBuffer,
      'application/pdf',
      200,
      64 * 1024 // Chunk size
    );

    if (!success) {
      console.log('PDF send failed or aborted');
    }
  });

  /**
   * Example 5: Stream with progress tracking
   */
  app.get('/api/backup/database', async (ctx) => {
    const totalRecords = await getTotalRecordCount();
    let sentRecords = 0;

    async function* backupChunks() {
      const tables = ['users', 'posts', 'comments', 'likes'];
      
      for (const table of tables) {
        if (ctx.aborted) break;
        
        const records = await exportTable(table);
        const chunk = JSON.stringify({ table, records });
        
        sentRecords += records.length;
        console.log(`Progress: ${sentRecords}/${totalRecords} records`);
        
        yield Buffer.from(chunk + '\n');
      }
    }

    await ctx.stream(backupChunks(), 'application/x-ndjson');
  });

  /**
   * Example 6: Check backpressure status manually
   */
  app.get('/api/manual-stream', async (ctx) => {
    // This is an advanced example showing manual backpressure handling
    // In practice, use ctx.stream() which handles this automatically
    
    if (ctx.aborted || !ctx.res) return;
    
    ctx.status(200).setHeader('Content-Type', 'text/plain');
    ctx.responded = true;

    const res = ctx.res;
    res.writeStatus('200 OK');
    res.writeHeader('Content-Type', 'text/plain');

    const data = Buffer.from('A'.repeat(1024 * 1024)); // 1MB

    for (let i = 0; i < 100; i++) {
      if (ctx.aborted || !ctx.res) break;

      // Check write offset (how much buffered)
      const offset = ctx.getWriteOffset();
      console.log(`Write offset: ${offset} bytes buffered`);

      // Try to send chunk
      const [ok, done] = res.tryEnd(data, 100 * data.length);

      if (done) break;

      if (!ok) {
        // Backpressure! Client is slow
        console.warn('Backpressure detected, waiting for drain...');
        // In real code, use ctx.stream() which handles this automatically
      }
    }
  });

  /**
   * Example 7: Stream with error handling and cleanup
   */
  app.get('/api/download/:id', async (ctx) => {
    const { id } = ctx.params!;
    let fileHandle: any = null;

    try {
      fileHandle = await openFileHandle(id);
      const fileSize = await getFileSize(fileHandle);

      async function* fileStream() {
        try {
          while (true) {
            if (ctx.aborted) break;
            
            const chunk = await readChunk(fileHandle, 64 * 1024);
            if (!chunk || chunk.length === 0) break;
            
            yield chunk;
          }
        } finally {
          // Cleanup on error or completion
          if (fileHandle) {
            await closeFileHandle(fileHandle);
            fileHandle = null;
          }
        }
      }

      const success = await ctx.stream(
        fileStream(),
        'application/octet-stream',
        200,
        fileSize
      );

      console.log(success ? 'Stream completed' : 'Stream aborted');
      
    } catch (error) {
      console.error('Stream error:', error);
      
      // Cleanup
      if (fileHandle) {
        await closeFileHandle(fileHandle);
      }
      
      if (!ctx.aborted && !ctx.responded) {
        ctx.status(500).json({ error: 'Stream failed' });
      }
    }
  });

  /**
   * Example 8: Throttle streaming to limit bandwidth
   */
  app.get('/api/download/throttled', async (ctx) => {
    const maxBytesPerSecond = 1024 * 1024; // 1 MB/s
    const chunkSize = 64 * 1024; // 64 KB
    const delayMs = (chunkSize / maxBytesPerSecond) * 1000;

    async function* throttledChunks() {
      const data = await generateLargeData();
      
      for (let i = 0; i < data.length; i += chunkSize) {
        if (ctx.aborted) break;
        
        yield data.subarray(i, Math.min(i + chunkSize, data.length));
        
        // Throttle
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    await ctx.stream(throttledChunks(), 'application/octet-stream');
  });
}

// =================== HELPER FUNCTIONS ===================

async function fetchUsersBatch(offset: number, limit: number): Promise<any[]> {
  // Simulate database query
  return Array.from({ length: Math.min(limit, 1000 - offset) }, (_, i) => ({
    id: offset + i,
    name: `User ${offset + i}`,
    email: `user${offset + i}@example.com`
  }));
}

async function fetchLargeDataset(): Promise<any[]> {
  return Array.from({ length: 10000 }, (_, i) => ({
    id: i,
    value: Math.random(),
    timestamp: Date.now()
  }));
}

async function generateLargePDF(): Promise<Buffer> {
  // Simulate PDF generation
  return Buffer.alloc(10 * 1024 * 1024, 'PDF content');
}

async function getTotalRecordCount(): Promise<number> {
  return 50000;
}

async function exportTable(table: string): Promise<any[]> {
  // Simulate table export
  return Array.from({ length: 1000 }, (_, i) => ({ id: i, table }));
}

async function openFileHandle(id: string): Promise<any> {
  return { id, position: 0 };
}

async function getFileSize(handle: any): Promise<number> {
  return 100 * 1024 * 1024; // 100MB
}

async function readChunk(handle: any, size: number): Promise<Buffer | null> {
  // Simulate reading chunk
  if (handle.position >= 100 * 1024 * 1024) return null;
  handle.position += size;
  return Buffer.alloc(size);
}

async function closeFileHandle(handle: any): Promise<void> {
  console.log('Closed file handle:', handle.id);
}

async function generateLargeData(): Promise<Buffer> {
  return Buffer.alloc(50 * 1024 * 1024, 'X'); // 50MB
}

// =================== ANTI-PATTERNS (DON'T DO THIS!) ===================

/**
 * ❌ BAD: Loading entire file into memory
 */
function badExample1(ctx: Context) {
  // DON'T DO THIS!
  const fs = require('fs');
  const data = fs.readFileSync('./large-file.bin'); // Loads 1GB into RAM!
  ctx.send(data); // Then buffers it all again if client is slow!
  // Result: 2GB+ RAM usage, possible OOM crash
}

/**
 * ❌ BAD: JSON.stringify on huge array
 */
function badExample2(ctx: Context, largeArray: any[]) {
  // DON'T DO THIS!
  const json = JSON.stringify(largeArray); // Buffers entire JSON string in memory
  ctx.json(largeArray); // Even worse - does it twice!
  // Result: Massive memory spike, GC pressure
}

/**
 * ❌ BAD: No backpressure handling when sending chunks
 */
function badExample3(ctx: Context) {
  // DON'T DO THIS!
  // Hypothetical example - shows why you need backpressure handling
  // In reality, use ctx.stream() which handles this automatically
  console.log('This is an anti-pattern example');
  // Result: Would buffer all chunks in memory if client is slow
}

/**
 * ✅ GOOD: Use ctx.stream() or ctx.sendLarge()
 */
async function goodExample(ctx: Context) {
  // DO THIS instead:
  async function* chunks() {
    for (let i = 0; i < 10000; i++) {
      yield Buffer.from(`Chunk ${i}\n`);
    }
  }
  
  await ctx.stream(chunks()); // Handles backpressure automatically!
  // Result: Constant low memory usage, no matter how slow the client
}
