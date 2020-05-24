const { RBTree } = require('bintrees');
const BigNumber = require('bignumber.js');
const assert = require('assert');

class Orderbook {
  constructor() {
    this._ordersByID = {};
    this._bids = new RBTree((a, b) => a.price.comparedTo(b.price));
    this._asks = new RBTree((a, b) => a.price.comparedTo(b.price));
  }

  _getTree(side) {
    return side === 'buy' ? this._bids : this._asks;
  }

  state(book,options) {
    if (book) {
      if(options != null && options.reset) {
        this._ordersByID = {};
        this._bids.clear();
        this._asks.clear();
      }
      book.bids.forEach(order =>
        this.add({
          id: order[2],
          side: 'buy',
          price: BigNumber(order[0]),
          size: BigNumber(order[1]),
        })
      );

      book.asks.forEach(order =>
        this.add({
          id: order[2],
          side: 'sell',
          price: BigNumber(order[0]),
          size: BigNumber(order[1]),
        })
      );
    } else {
      book = { asks: [], bids: [] };

      this._bids.reach(bid => book.bids.push(...bid.orders));
      this._asks.each(ask => book.asks.push(...ask.orders));

      return book;
    }
  }

  get(orderId) {
    return this._ordersByID[orderId];
  }

  add(order) {
    let id;
    let size;

    if(order.order_id != null) id = order.order_id;
    else id = order.id;
    if(order.size != null) size = BigNumber(order.size);
    else size = BigNumber(order.remaining_size);
    order = {
      id: id,
      side: order.side,
      price: BigNumber(order.price),
      size: size
    };

    //if(order.size != null && order.remaining_size != null) console.log("both size and remaining_size are not null");

    const tree = this._getTree(order.side);
    let node = tree.find({ price: order.price });

    if (!node) {
      node = {
        price: order.price,
        orders: [],
      };
      tree.insert(node);
    }

    node.orders.push(order);
    this._ordersByID[order.id] = order;
  }

  remove(orderId,options) {
    const order = this.get(orderId);

    if (!order) {
      return;
    }

    const tree = this._getTree(order.side);
    const node = tree.find({ price: order.price });
    assert(node);
    const { orders } = node;

    //console.log(`removing ${order.price.toNumber()}`);

    orders.splice(orders.indexOf(order), 1);

    //if(options != null && options.print) console.log(orders);

    if (orders.length === 0) {
      tree.remove(node);
    }

    delete this._ordersByID[order.id];
  }

  match(match) {
    const size = BigNumber(match.size);
    const price = BigNumber(match.price);
    const tree = this._getTree(match.side);
    const node = tree.find({ price: price });
    assert(node);

    const order = node.orders.find(order => order.id === match.maker_order_id);

    assert(order);

    order.size = order.size.minus(size);
    this._ordersByID[order.id] = order;

    assert(order.size >= 0);

    //console.log(`match = ${JSON.stringify(match)}`);

    if (order.size.eq(0)) {
      //console.log(`match price = ${price.toNumber()}, filled`);
      this.remove(order.id);
    }
    //else console.log(`match price = ${price.toNumber()}, remaining = ${order.size.toNumber()}`);
  }

  change(change) {
    // price of null indicates market order
    if (change.price === null || change.price === undefined) {
      return;
    }

    //console.log(change);

    const size = BigNumber(change.new_size);
    const price = BigNumber(change.price);
    const order = this.get(change.order_id);
    const tree = this._getTree(change.side);
    const node = tree.find({ price });

    if (!node || node.orders.indexOf(order) < 0) {
      //console.log("change for null");
      return;
    }

    const nodeOrder = node.orders[node.orders.indexOf(order)];

    const newSize = parseFloat(order.size);
    const oldSize = parseFloat(change.old_size);

    assert.equal(oldSize, newSize);

    nodeOrder.size = size;
    this._ordersByID[nodeOrder.id] = nodeOrder;
  }
}

module.exports = exports = Orderbook;
