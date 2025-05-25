// shared-worker.js

// Keep track of all connected ports (tabs/clients)
const connectedPorts = new Set();
let sharedCounter = 0; // Example of shared state

console.log('[SharedWorker] Script loaded. Waiting for connections.');

self.onconnect = function(event) {
  const port = event.ports[0];
  connectedPorts.add(port);
  console.log(`[SharedWorker] New connection. Port added. Total ports: ${connectedPorts.size}`);

  // Send an initial message to the newly connected client
  port.postMessage({ 
    type: 'CONNECTION_ESTABLISHED', 
    message: 'Connection to SharedWorker established!',
    id: Date.now(), // Unique ID for this message
    portCount: connectedPorts.size,
    sharedCounterValue: sharedCounter
  });

  port.onmessage = function(e) {
    const messageData = e.data;
    console.log('[SharedWorker] Message received:', messageData);
    console.log(`[SharedWorker] Broadcasting to ${connectedPorts.size - 1} other ports.`);

    // Example: Simple counter increment on a specific message type
    if (messageData.action === 'INCREMENT_COUNTER') {
      sharedCounter++;
      // Broadcast new counter value to all ports
      broadcastMessage({ 
        type: 'COUNTER_UPDATED', 
        sharedCounterValue: sharedCounter,
        fromId: messageData.clientId // Assuming client sends an ID
      });
    } else if (messageData.action === 'GET_COUNTER') {
        // Send current counter value back to the requesting client
        port.postMessage({
            type: 'COUNTER_VALUE',
            sharedCounterValue: sharedCounter
        });
    } else {
      // Generic message broadcasting to other ports
      broadcastToOthers(port, { 
        type: 'BROADCAST_MESSAGE', 
        originalMessage: messageData,
        fromPort: 'some_identifier_if_needed', // This needs a way to identify sender if not in messageData
        timestamp: new Date().toISOString()
      });
    }
  };

  port.onmessageerror = function(e) {
    console.error('[SharedWorker] Error in message received on port:', e);
  };
  
  // Optional: Start the port explicitly if needed, though it's often started by the client.
  // port.start(); // Usually client calls port.start() or worker.port.start()

  // Handle port disconnection (when a tab closes)
  port.addEventListener('close', () => { // Not standard, but some browsers might support this or similar on MessagePort
    console.log('[SharedWorker] Port disconnected (possibly).');
    // connectedPorts.delete(port); // This 'close' event is not reliably fired or standard on MessagePort.
    // Managing disconnected ports is tricky; often relies on heartbeats or explicit disconnect messages.
  });
  // A common way to detect disconnect is if postMessage fails, or via a ping/pong mechanism.
  // For this basic version, we'll rely on browser closing the connection.
};

function broadcastMessage(message) {
  console.log('[SharedWorker] Broadcasting to all ports:', message);
  connectedPorts.forEach(p => {
    try {
      p.postMessage(message);
    } catch (e) {
      console.error('[SharedWorker] Error broadcasting to a port, removing it:', e);
      connectedPorts.delete(p);
    }
  });
}

function broadcastToOthers(senderPort, message) {
  connectedPorts.forEach(p => {
    if (p !== senderPort) {
      try {
        p.postMessage(message);
      } catch (e) {
        console.error('[SharedWorker] Error broadcasting (to others) to a port, removing it:', e);
        connectedPorts.delete(p);
      }
    }
  });
}

// Optional: A message to signal this worker is active when a new client connects.
// This is handled by the 'CONNECTION_ESTABLISHED' message to the connecting port.

console.log('[SharedWorker] Event listeners set up.');

// Note: To make this worker truly useful for the data library, it might handle:
// - Centralized replication triggering (if not using LeaderElection or for specific tasks)
// - Broadcasting data updates to other tabs after one tab syncs.
// - Managing shared resources or locks.
// The current implementation is a basic broadcaster and counter example.
