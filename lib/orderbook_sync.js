const WebsocketClient = require('./clients/websocket.js');
const AuthenticatedClient = require('./clients/authenticated.js');
const PublicClient = require('./clients/public.js');
const Orderbook = require('./orderbook.js');
const Utils = require('./utilities.js');

// Orderbook syncing
class OrderbookSync extends WebsocketClient {
  constructor(
    productIDs,
    apiURI = 'https://api.pro.coinbase.com',
    websocketURI = 'wss://ws-feed.pro.coinbase.com',
    auth = null
  ) {
    super(productIDs, websocketURI, auth);
    this.apiURI = apiURI;
    this.auth = Utils.checkAuth(auth);

    this._queues = {}; // []
    this._replay_divert = {}; // []
    this._sequences = {}; // -1
    this.books = {};

    if (this.auth.secret) {
      this._client = new AuthenticatedClient(
        this.auth.key,
        this.auth.secret,
        this.auth.passphrase,
        this.apiURI
      );
    } else {
      this._client = new PublicClient(this.apiURI);
    }

    this.productIDs.forEach(this._newProduct, this);

    this.on('message', this.processMessage.bind(this));
  }

  _newProduct(productID) {
    this._queues[productID] = [];
    this._replay_divert[productID] = false;
    this._sequences[productID] = -2;
    this.books[productID] = new Orderbook();
  }

  loadOrderbook(productID) {
    if (!this.books[productID]) {
      return;
    }

    //this._queues[productID] = [];
    //this._sequences[productID] = -1;

    this.emit('sync', productID);
    const process = data => {
      this.books[productID].state(data,{ reset:true });
      this._sequences[productID] = data.sequence;
      console.log(`sync start ${this._sequences[productID]}`);
      this._replay_divert[productID] = true;
      while(this._queues[productID].length > 0 && this._sequences[productID] != -1) {
        let replay = this._queues[productID];

        this._queues[productID] = [];
        console.log(`replaying ${replay.length} events`);
        replay.forEach(this.processMessage,this);
      }
      this._replay_divert[productID] = false;
      if(this._sequences[productID] != -1) this.emit('synced', productID);
    };

    const problems = err => {
      err = err && (err.message || err);
      this.emit('error', new Error('Failed to load orderbook: ' + err));
    };

    this._client
      .getProductOrderBook(productID, { level: 3 })
      .then(process)
      .catch(problems);
  }

  // subscriptions changed -- possible new products
  _newSubscription(data) {
    const channel = data.channels.find(c => c.name === 'full');
    channel &&
      channel.product_ids
        .filter(productID => !(productID in this.books))
        .forEach(this._newProduct, this);
  }

  processMessage(data,index) {
    const { type, product_id } = data;

    if (type === 'subscriptions') {
      //console.log("sub message:",JSON.stringify(data));
      this._newSubscription(data);
      return;
    }

    //if(index != null) console.log(`replaying index ${index} seq = ${data.sequence}`);

    if(this._sequences[product_id] < 0 && index == null) {
      // Orderbook snapshot not loaded yet
      this._queues[product_id].push(data);
      //console.log(`queuing ${data.sequence} --> ${product_id} (${this._queues[product_id].length})`);
    }

    if(this._replay_divert[product_id] && index == null) {
      //console.log(`diverting ${data.sequence} --> ${product_id} (${this._queues[product_id].length}) during replay`);
      this._queues[product_id].push(data);
      return;
    }

    if (this._sequences[product_id] === -2) {
      // Start first sync
      console.log("start first sync");
      this._sequences[product_id] = -1;
      this._queues[product_id] = [];
      setTimeout(() => this.loadOrderbook(product_id),1300);
      return;
    }

    if (this._sequences[product_id] === -1) {
      // Resync is in process
      return;
    }

    if (data.sequence <= this._sequences[product_id]) {
      //if(data.sequence < this._sequences[product_id]) console.log("seq number out of order");
      // Skip this one, since it was already processed
      return;
    }

    //console.log("new event seq = ",data.sequence,"last processed seq",this._sequences[product_id]);

    if (data.sequence !== this._sequences[product_id] + 1) {
      // Dropped a message, start a resync process
      console.log("resync");
      this._replay_divert[product_id] = false;
      this._sequences[product_id] = -1;
      this._queues[product_id] = [];
      setTimeout(() => this.loadOrderbook(product_id),1300);
      return;
    }

    this._sequences[product_id] = data.sequence;
    const book = this.books[product_id];

    try
    {
      switch (type) {
        case 'open':
          //console.log(`ADD ${data.order_id}`);
          book.add(data);
          break;

        case 'done':
          //if(data.reason != "canceled") console.log(`remove ${JSON.stringify(data)}`);
          //console.log(`REMOVE ${data.order_id}`);
          book.remove(data.order_id);
          break;

        case 'match':
          //console.log(`match ${JSON.stringify(data)}`);
          //console.log(`MATCH ${data.market_order_id}`);
          book.match(data);
          break;

        case 'change':
          //console.log(`CHANGE ${data.order_id}`);
          book.change(data);
          break;
      }
    }
    catch(e) { console.log("error during processing message: ",e); }
  }
}

module.exports = exports = OrderbookSync;
