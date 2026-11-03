// Async Testing Library queries default to 1 s, which slow CI runners exceed.
import { configure } from "@testing-library/dom";
configure({ asyncUtilTimeout: 5000 });
