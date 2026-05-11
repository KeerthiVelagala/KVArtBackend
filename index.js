console.log("🚀 BACKEND DEPLOYED VERSION 1.0");
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
let Razorpay;
try { Razorpay = require('razorpay'); } catch (e) { /* optional */ }
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5001;
app.use(express.json());
app.use(
cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
})
);


const mongoose = require('mongoose');
const Order = require('./models/order');

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.log(err));
// app.options('*', cors());

// Simple request logger (dev)
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

// In-memory store for dev
const payments = {};
// const orders = {};
// phnpay initiate (mock or real provider)
app.post('/api/phnpay/initiate', (req, res) => {
  console.log('POST /api/phnpay/initiate body:', req.body);
  const { amount, upiId } = req.body || {};
  const numeric = Number(amount || 0);
  if (!upiId || numeric <= 0) return res.status(400).json({ error: 'amount (positive) and upiId required' });

  // If real provider configured you would call it here.
  // Dev mock:
  const paymentId = uuidv4();
  payments[paymentId] = { status: 'PENDING', amount: numeric, upiId, createdAt: Date.now() };
  const paymentUrl = `http://127.0.0.1:${PORT}/mock-pay?paymentId=${encodeURIComponent(paymentId)}`;
  return res.json({ paymentId, paymentUrl });
});

// phnpay status
app.get('/api/phnpay/status', (req, res) => {
  const { paymentId } = req.query;
  if (!paymentId || !payments[paymentId]) return res.status(404).json({ error: 'payment not found' });
  return res.json({ status: payments[paymentId].status });
});

// Mock payment page - marks payment SUCCESS for dev
app.get('/mock-pay', (req, res) => {
  const { paymentId } = req.query;
  if (!paymentId || !payments[paymentId]) return res.status(404).send('Payment not found');
  payments[paymentId].status = 'SUCCESS';
  res.send(`
    <html>
      <body style="font-family:sans-serif; text-align:center; padding:40px;">
        <h2>Mock Payment</h2>
        <p>Payment for ₹${payments[paymentId].amount} marked SUCCESS.</p>
        <p><a href="http://localhost:3000/checkout">Return to app</a></p>
      </body>
    </html>
  `);
});

// phnpay webhook simulator
app.post('/api/phnpay/webhook', (req, res) => {
  const { paymentId, status } = req.body || {};
  if (!paymentId || !payments[paymentId]) return res.status(404).json({ error: 'payment not found' });
  payments[paymentId].status = status || 'FAILED';
  return res.json({ ok: true });
});

// Razorpay integration endpoints (requires env RZP_KEY_ID and RZP_KEY_SECRET)
let razorpayClient = null;
if (process.env.RZP_KEY_ID && process.env.RZP_KEY_SECRET && Razorpay) {
  razorpayClient = new Razorpay({ key_id: process.env.RZP_KEY_ID, key_secret: process.env.RZP_KEY_SECRET });
  console.log('Razorpay client configured');
} else {
  console.log('Razorpay not configured (set RZP_KEY_ID + RZP_KEY_SECRET and install razorpay)');
}

// app.post('/api/razorpay/create-order', async (req, res) => {
//   if (!razorpayClient) return res.status(500).json({ error: 'razorpay not configured' });
//   try {
//     const { amount, currency = 'INR', receipt } = req.body || {};
//     if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'invalid amount' });
//     const opts = {
//       amount: Math.round(Number(amount) * 100), // paise
//       currency,
//       receipt: receipt || `rcpt_${Date.now()}`,
//       payment_capture: 1,
//     };
//     const order = await razorpayClient.orders.create(opts);
//     return res.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RZP_KEY_ID });
//   } catch (err) {
//     console.error('razorpay create-order error', err?.response?.data || err.message);
//     return res.status(502).json({ error: 'create order failed', details: err?.response?.data || err.message });
//   }
// });

app.post('/api/razorpay/create-order', async (req, res) => {
  if (!razorpayClient) return res.status(500).json({ error: 'razorpay not configured' });

  try {
    const { amount, currency = 'INR', receipt, items, customer } = req.body || {};

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'invalid amount' });
    }

    // 1. Create internal order ID
    const orderIdInternal = uuidv4();

    console.log("ORDER SAVED:", orderIdInternal);


    // 2. Save order in backend
 const newOrder = await Order.create({
  customer,
  items,
  amount,
  status: 'CREATED'
});
console.log("ORDER CREATED:", newOrder);
    // 3. Create Razorpay order
    const options = {
      amount: Math.round(Number(amount) * 100),
      currency,
      receipt: receipt || orderIdInternal,
      payment_capture: 1,
    };

  const order = await razorpayClient.orders.create(options);

    // 4. Link Razorpay order → your order
 newOrder.razorpayOrderId = order.id;
 await newOrder.save();

    return res.json({
      orderId: order.id,
      internalOrderId: orderIdInternal,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RZP_KEY_ID
    });

  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: 'create order failed' });
  }
});

// app.post('/api/razorpay/verify', (req, res) => {
//   const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
//   if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) return res.status(400).json({ error: 'missing fields' });
//   const generated = crypto.createHmac('sha256', process.env.RZP_KEY_SECRET || '').update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
//   if (generated === razorpay_signature) return res.json({ ok: true });
//   return res.status(400).json({ error: 'invalid signature' });
// });

// app.post('/api/razorpay/verify', (req, res) => {
//   const { razorpay_order_id, razorpay_payment_id, razorpay_signature, internalOrderId } = req.body || {};

//   const generated = crypto
//     .createHmac('sha256', process.env.RZP_KEY_SECRET || '')
//     .update(`${razorpay_order_id}|${razorpay_payment_id}`)
//     .digest('hex');

//   if (generated === razorpay_signature) {
//     if (orders[internalOrderId]) {
//       orders[internalOrderId].status = 'PAID';
//       orders[internalOrderId].paymentId = razorpay_payment_id;
//     }

//     return res.json({ ok: true });
//   }

//   return res.status(400).json({ error: 'invalid signature' });
// });

app.post('/api/razorpay/verify', async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature
  } = req.body;

  const generated = crypto
    .createHmac('sha256', process.env.RZP_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (generated === razorpay_signature) {

    await Order.findOneAndUpdate(
      { razorpayOrderId: razorpay_order_id },
      {
        status: 'PAID',
        paymentId: razorpay_payment_id
      }
    );

    return res.json({ ok: true });
  }

  return res.status(400).json({ error: 'invalid signature' });
});

// app.get('/api/orders/:id', (req, res) => {
//   const order = orders[req.params.id];
//   if (!order) return res.status(404).json({ error: 'not found' });
//   res.json(order);
// });

app.get('/api/orders', async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: 'failed to fetch orders' });
  }
});

app.get('/api/debug-orders', async (req, res) => {
  const count = await Order.countDocuments();
  const all = await Order.find();
  
  console.log("COUNT:", count);
  console.log("DATA:", all);

  res.json({ count, data: all });
});

app.get('/api/orders/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'not found' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: 'error fetching order' });
  }
});

// Start server - bind to all interfaces so 127.0.0.1 and ::1 reach it
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});