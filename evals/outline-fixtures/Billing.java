package shop;

public class Billing {
    private final Repo repo;

    public Billing(Repo repo) {
        this.repo = repo;
    }

    public long total(List<Long> items) {
        return items.stream().mapToLong(x -> x).sum();
    }
}
