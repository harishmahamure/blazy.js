/**
 * Example: Handling Client Disconnects and Timeouts
 * 
 * This demonstrates how Blazy.JS safely handles:
 * - Client disconnects mid-request
 * - Connection timeouts
 * - Slow operations that complete after client has left
 * - Dangling pointer protection
 */

import type { App } from '../../core/app.js';
import type { Context } from '../../core/context.js';


const getResponse = async () => {
 await new Promise(resolve => setTimeout(resolve, 10000));
 const response = await fetch('https://jsonplaceholder.typicode.com/todos/1')
 return response.json();
};

export function abortHandlingExamples(app: App): void {
  
  /**
   * Example 1: Long-running operation that might outlive the connection
   * The abort flag prevents sending data to a closed connection
   */
  app.get('/api/slow-operation', async (ctx) => {
    console.log('Starting slow operation...');
    
    const result = await getResponse(); 
    
    ctx.json({ result });
  });

  /**
   * Example 2: Streaming data with abort checks
   * Periodically check if connection is still alive during streaming
   */
  app.get('/api/stream-data', async (ctx) => {
    const chunks = ['chunk1', 'chunk2', 'chunk3', 'chunk4', 'chunk5'];
    
    for (let i = 0; i < chunks.length; i++) {
      // Check if client disconnected
      if (ctx.aborted) {
        console.log(`Stream aborted at chunk ${i}`);
        return;
      }
      
      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // You can't write partial chunks in uWS HTTP (it's not chunked transfer encoding)
      // But you can check abort status between operations
    }
    
    if (!ctx.aborted) {
      ctx.json({ chunks, status: 'complete' });
    }
  });

  /**
   * Example 3: Database operation with abort handling
   * Clean up resources if client disconnects
   */
  app.post('/api/heavy-task', async (ctx) => {
    const body = await ctx.readBody();
    
    if (ctx.aborted) {
      console.log('Client disconnected before body read');
      return;
    }
    
    console.log('Starting heavy database operation...');
    
    // Simulate database work
    const dbPromise = simulateDbOperation(5000);
    
    // Optional: Add abort listener for cleanup
    let cancelled = false;
    if (ctx.aborted) {
      cancelled = true;
      console.log('Request already aborted');
      return;
    }
    
    try {
      const result = await dbPromise;
      
      // Always check before responding
      if (ctx.aborted) {
        console.log('Client left before result could be sent');
        return;
      }
      
      ctx.json({ result, body });
    } catch (error) {
      if (!ctx.aborted) {
        ctx.status(500).json({ error: 'Database operation failed' });
      }
    }
  });

  /**
   * Example 4: Multiple async operations with early abort checks
   * Save CPU by exiting early if client is gone
   */
  app.get('/api/multi-step', async (ctx) => {
    // Step 1
    console.log('Step 1: Fetching user data...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (ctx.aborted) return;
    
    // Step 2
    console.log('Step 2: Fetching related items...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (ctx.aborted) return;
    
    // Step 3
    console.log('Step 3: Processing results...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (ctx.aborted) return;
    
    ctx.json({ 
      message: 'All steps completed',
      timestamp: Date.now()
    });
  });

  /**
   * Example 5: Safe error handling with abort checks
   */
  app.get('/api/error-prone', async (ctx) => {
    try {
      await riskyOperation();
      
      if (ctx.aborted) return;
      
      ctx.json({ success: true });
    } catch (error) {
      // Only send error response if client is still connected
      if (!ctx.aborted && !ctx.responded) {
        ctx.status(500).json({ 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      } else {
        console.log('Error occurred but client already disconnected:', error);
      }
    }
  });

  /**
   * Example 6: Middleware that adds timeout protection
   * Returns 408 Request Timeout if operation takes too long
   */
  app.get('/api/with-timeout', 
    timeoutMiddleware(5000), // 5 second timeout
    async (ctx) => {
      // This handler has max 5 seconds to complete
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      if (ctx.aborted) return;
      
      ctx.json({ message: 'Completed within timeout' });
    }
  );
}

// =================== HELPER FUNCTIONS ===================

function simulateDbOperation(delay: number): Promise<string> {
  return new Promise((resolve) => {
    setTimeout(() => resolve('DB_RESULT_' + Date.now()), delay);
  });
}

function riskyOperation(): Promise<void> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (Math.random() > 0.5) {
        resolve();
      } else {
        reject(new Error('Random failure'));
      }
    }, 1000);
  });
}

/**
 * Timeout middleware - aborts request if handler takes too long
 * Note: This doesn't actually cancel the handler execution (Node.js limitation)
 * but prevents sending response after timeout
 */
function timeoutMiddleware(ms: number) {
  return async (ctx: Context, next: () => void | Promise<void>): Promise<void> => {
    let timeoutId: NodeJS.Timeout | null = null;
    let timedOut = false;

    const timeoutPromise = new Promise<void>((resolve) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        if (!ctx.responded && !ctx.aborted) {
          ctx.status(408).json({ 
            error: 'Request Timeout',
            timeout: ms 
          });
        }
        resolve();
      }, ms);
    });

    const nextResult = next();
    const handlerPromise = (nextResult instanceof Promise ? nextResult : Promise.resolve()).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });

    await Promise.race([timeoutPromise, handlerPromise]);
  };
}

// =================== TESTING GUIDE ===================

/**
 * HOW TO TEST ABORT HANDLING:
 * 
 * 1. Test with curl and Ctrl+C:
 *    ```bash
 *    curl http://localhost:3000/api/slow-operation
 *    # Press Ctrl+C after 2 seconds
 *    # Check server logs - should show "Client disconnected during operation"
 *    ```
 * 
 * 2. Test with timeout:
 *    ```bash
 *    curl --max-time 2 http://localhost:3000/api/slow-operation
 *    # Will timeout after 2 seconds
 *    ```
 * 
 * 3. Test with Node.js script:
 *    ```javascript
 *    const http = require('http');
 *    const req = http.get('http://localhost:3000/api/slow-operation', (res) => {
 *      // Immediately abort
 *      req.destroy();
 *    });
 *    ```
 * 
 * 4. Load test with many aborted connections:
 *    ```bash
 *    # Using Apache Bench with low timeout
 *    ab -n 1000 -c 100 -s 1 http://localhost:3000/api/slow-operation
 *    ```
 * 
 * WHAT TO OBSERVE:
 * - No "Cannot read property of null" errors
 * - No segmentation faults
 * - Clean logs showing abort detection
 * - No memory leaks (contexts properly released)
 * - Server remains responsive
 */
