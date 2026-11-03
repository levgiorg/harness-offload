require "json"

module Shop
  class Shipping
    def initialize(rates)
      @rates = rates
    end

    def quote(weight)
      @rates.fetch(weight)
    end
  end
end
