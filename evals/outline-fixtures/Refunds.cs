using System;

namespace Shop
{
    public class Refunds
    {
        public decimal Total(decimal[] items)
        {
            return items.Sum();
        }

        private void Log(string msg)
        {
            Console.WriteLine(msg);
        }
    }
}
