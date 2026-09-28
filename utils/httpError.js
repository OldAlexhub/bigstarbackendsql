export const httpError = (status, message) => Object.assign(new Error(message), { status, publicMessage: true });

export const respondToHttpError = (error, res) => {
  if (!error.status) throw error;
  return res.status(error.status).json({ message: error.message });
};
