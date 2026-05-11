const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  customer: {
    name: String,
    address: String,
    city: String,
    pincode: String
  },
  items: Array,
  amount: Number,
  status: {
    type: String,
    default: 'CREATED'
  },
  razorpayOrderId: String,
  paymentId: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Order', orderSchema);