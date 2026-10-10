
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },

    name: {
      type: String,
      default: ''
    },

    avatar: {
      type: String,
      default: ''
    },

    providers: [
      {
        provider: {
          type: String,
          enum: ['google', 'apple', 'microsoft'],
          required: true
        },

        providerId: {
          type: String,
          required: true
        }
      }
    ],

    role: {
      type: String,
      enum: ['user', 'pro', 'admin'],
      default: 'user'
    },

    isActive: {
      type: Boolean,
      default: true
    },

    proExpiresAt: {
      type: Date,
      default: null
    },

    lastLoginAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

userSchema.index(
  { 'providers.provider': 1, 'providers.providerId': 1 },
  { unique: true }
);

module.exports = mongoose.model('User', userSchema);
