import { Schema, model } from 'mongoose';
const packageSchema = new Schema({
    name: { type: String, required: true, unique: true },
    price: { type: Number, required: true },
    billingCycle: { type: String, enum: ['monthly', 'yearly'], required: true },
    productLimit: { type: Number, required: true },
    isActive: { type: Boolean, default: true },
}, {
    timestamps: true,
});
export const Package = model('Package', packageSchema);
